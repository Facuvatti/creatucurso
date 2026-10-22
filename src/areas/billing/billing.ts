// Academy billing (Phase 8, ADR-0029): the free trial and its student limit,
// daily usage metering, the monthly close and the billing state that gates
// enrollments, checkout, the panel and the public site. The Mercado Pago
// subscription that pays the invoices lives in subscription.ts.
import { emitEvent, inTransaction, pool } from "../../server/db.server.ts";
import { escapeHtml, sendPlatformEmail } from "../../server/email.server.ts";
import { tenantOrigin } from "../../server/origins.server.ts";

const GB = 1024 ** 3;
const DAY_MS = 86_400_000;

export const TRIAL_DAYS = 30;
export const TRIAL_STUDENT_LIMIT = 10;
/**
 * Academies created before billing existed start their trial on the day billing
 * was deployed (env BILLING_TRIAL_START, default the day Phase 8 was built), not
 * on their creation date.
 */
function billingStart(): Date {
	const start = new Date(process.env.BILLING_TRIAL_START || "2026-10-21");
	if (Number.isNaN(start.getTime())) {
		throw new Error("BILLING_TRIAL_START must be a date (YYYY-MM-DD).");
	}
	return start;
}

/**
 * Unit prices are what the video costs the PLATFORM, in ARS: the daily usage
 * records that cost for the owner's numbers, it is not charged to the academy.
 */
export function billingConfig() {
	return {
		pricePerGbStream: Number(process.env.BILLING_PRICE_PER_GB_STREAM || 15),
		pricePerGbStorageMonth: Number(
			process.env.BILLING_PRICE_PER_GB_STORAGE_MONTH || 25,
		),
		graceDays: Number(process.env.BILLING_GRACE_DAYS || 10),
		currency: "ARS",
	};
}

// ------------------------------------------------------------------ plans
// The owner's plans (docs/planes_suscripcion.md), in ARS minor units. Every
// feature is in every plan: plans change only the price. The payment gateway's
// own fee (~2%) is charged by the gateway to the academy, apart from these.

export type Plan = "commission" | "hybrid" | "flat";

export const PLANS: Record<
	Plan,
	{
		name: string;
		/** Monthly fee per course. */
		feePerCourse: number;
		/** Platform commission on each sale (fraction of the amount paid). */
		rate: number;
		/** Minimum platform commission per sale (never more than the sale itself). */
		minPerSale: number;
	}
> = {
	commission: {
		name: "Solo Comisión",
		feePerCourse: 0,
		rate: 0.35,
		minPerSale: 5_000_00,
	},
	hybrid: {
		name: "Híbrido",
		feePerCourse: 5_000_00,
		rate: 0.05,
		minPerSale: 1_000_00,
	},
	flat: {
		name: "Flat por Curso",
		feePerCourse: 10_000_00,
		rate: 0,
		minPerSale: 0,
	},
};

/** Flat plan: every 3 courses cost 25.000 instead of 30.000 (the bundle). */
const FLAT_BUNDLE = { courses: 3, price: 25_000_00 };

export function isPlan(value: unknown): value is Plan {
	return value === "commission" || value === "hybrid" || value === "flat";
}

/** Monthly fee of a plan for this many published courses. */
export function monthlyFee(plan: Plan, courses: number): number {
	const { feePerCourse } = PLANS[plan];
	if (plan !== "flat") return feePerCourse * courses;
	const bundles = Math.floor(courses / FLAT_BUNDLE.courses);
	return (
		bundles * FLAT_BUNDLE.price +
		(courses - bundles * FLAT_BUNDLE.courses) * feePerCourse
	);
}

/** Platform commission of one sale (net of refunds), minor units. */
export function commissionOf(plan: Plan, net: number): number {
	if (net <= 0) return 0;
	const { rate, minPerSale } = PLANS[plan];
	return Math.min(net, Math.max(Math.round(net * rate), minPerSale));
}

/** The plan in force on `day` (YYYY-MM-DD). Academies that never chose are on commission. */
export async function planOn(
	organizationId: string,
	day: string,
): Promise<Plan> {
	const { rows } = await pool.query<{ plan: Plan }>(
		`select plan from billing.academy_plan
		 where organization_id = $1 and effective_from <= $2::date
		 order by effective_from desc limit 1`,
		[organizationId, day],
	);
	return rows[0]?.plan ?? "commission";
}

/** The plan now and, when a change is scheduled, the next one with its date. */
export async function planChoice(organizationId: string): Promise<{
	current: Plan;
	next: { plan: Plan; from: string } | null;
}> {
	const { rows } = await pool.query<{
		plan: Plan;
		from: string;
		future: boolean;
	}>(
		`select plan, effective_from::text as from, effective_from > current_date as future
		 from billing.academy_plan where organization_id = $1
		 order by effective_from desc limit 2`,
		[organizationId],
	);
	const future = rows[0]?.future ? rows[0] : null;
	const current = (future ? rows[1] : rows[0])?.plan ?? "commission";
	return {
		current,
		next:
			future && future.plan !== current
				? { plan: future.plan, from: future.from }
				: null,
	};
}

/**
 * A change applies from the 1st of next month, so a month is billed with one
 * plan. During the trial (nothing billed yet) it applies right away.
 */
export async function choosePlan(organizationId: string, plan: Plan) {
	const state = await academyBillingState(organizationId);
	await pool.query(
		`insert into billing.academy_plan (organization_id, effective_from, plan)
		 values ($1, case when $3 then current_date
		                  else (date_trunc('month', current_date) + interval '1 month')::date end, $2)
		 on conflict (organization_id, effective_from) do update set plan = excluded.plan, created_at = now()`,
		[organizationId, plan, state.status === "trial"],
	);
}

/**
 * What an academy owes for the days [from, stop) of one month: ONLY the plan's
 * fee for its published courses (prorated to the billed days). The platform
 * commission is collected at sale time through Mercado Pago's marketplace_fee
 * (ADR-0029, "Commission at sale"), so it is no longer billed here; it is still
 * computed into `details` for reference. Sales in another currency than ARS are
 * counted in the details but not charged (no conversion yet).
 */
export async function chargesFor(input: {
	organizationId: string;
	plan: Plan;
	from: string;
	stop: string;
	billedDays: number;
	monthDays: number;
}) {
	const { rows: courses } = await pool.query<{ n: number }>(
		`select count(*)::int as n from catalog.course where organization_id = $1 and status = 'published'`,
		[input.organizationId],
	);
	const publishedCourses = courses[0]?.n ?? 0;
	const fee = Math.round(
		(monthlyFee(input.plan, publishedCourses) * input.billedDays) /
			input.monthDays,
	);
	const { rows: sales } = await pool.query<{ net: number; currency: string }>(
		`select amount - refunded_amount as net, currency from payments.payment
		 where organization_id = $1 and status = 'succeeded'
		   and created_at >= $2::date and created_at < $3::date`,
		[input.organizationId, input.from, input.stop],
	);
	let commission = 0;
	let salesTotal = 0;
	let salesCount = 0;
	let otherCurrencySales = 0;
	for (const sale of sales) {
		if (sale.currency !== "ARS") {
			otherCurrencySales++;
			continue;
		}
		salesCount++;
		salesTotal += sale.net;
		commission += commissionOf(input.plan, sale.net);
	}
	return {
		// Fee-only: the commission is already collected at each sale (marketplace_fee).
		amount: fee,
		details: {
			plan: input.plan,
			publishedCourses,
			fee,
			salesCount,
			salesTotal,
			// Commission collected at sale time this period (informative, not billed here).
			commission,
			otherCurrencySales,
		},
	};
}

// ---------------------------------------------------------------- the state

export type BillingStatus = "trial" | "active" | "past_due" | "suspended";

export type BillingState = {
	status: BillingStatus;
	trialEndsAt: Date;
	/** Start of the current unpaid episode: a failed charge or no usable subscription. */
	pastDueSince: Date | null;
	suspendAt: Date | null;
};

const CACHE_MS = 30_000;
const cache = new Map<string, { state: BillingState; at: number }>();

export function forgetBillingState(organizationId: string): void {
	cache.delete(organizationId);
}

/**
 * The one billing gate. Trial for 30 days; then active while the subscription
 * is usable and no charge failed; past due from the first failed charge, the
 * end of the trial without a subscription, or a cancelled subscription; and
 * suspended once the grace period after that runs out. Cached for 30 seconds.
 */
export async function academyBillingState(
	organizationId: string,
): Promise<BillingState> {
	const hit = cache.get(organizationId);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
	const { rows } = await pool.query<{
		created_at: Date;
		sub_status: string | null;
		lapsed_at: Date | null;
		failed_since: Date | null;
	}>(
		`select o."createdAt" as created_at, s.status as sub_status, s.lapsed_at,
		   (select min(i.failed_at) from billing.invoice i
		    where i.organization_id = o.id and i.status = 'failed') as failed_since
		 from auth.organization o
		 left join billing.subscription s on s.organization_id = o.id
		 where o.id = $1`,
		[organizationId],
	);
	const row = rows[0];
	if (!row) throw new Error("Unknown academy.");

	const billingFrom = billingStart();
	const start = row.created_at > billingFrom ? row.created_at : billingFrom;
	const trialEndsAt = new Date(start.getTime() + TRIAL_DAYS * DAY_MS);
	let state: BillingState;
	if (Date.now() < trialEndsAt.getTime()) {
		state = {
			status: "trial",
			trialEndsAt,
			pastDueSince: null,
			suspendAt: null,
		};
	} else {
		const since: Date[] = [];
		if (row.failed_since) since.push(row.failed_since);
		const usable =
			row.sub_status === "authorized" || row.sub_status === "paused";
		if (!usable) {
			since.push(
				row.lapsed_at && row.lapsed_at > trialEndsAt
					? row.lapsed_at
					: trialEndsAt,
			);
		}
		if (since.length === 0) {
			state = {
				status: "active",
				trialEndsAt,
				pastDueSince: null,
				suspendAt: null,
			};
		} else {
			const pastDueSince = new Date(Math.min(...since.map((d) => d.getTime())));
			const suspendAt = new Date(
				pastDueSince.getTime() + billingConfig().graceDays * DAY_MS,
			);
			state = {
				status: Date.now() >= suspendAt.getTime() ? "suspended" : "past_due",
				trialEndsAt,
				pastDueSince,
				suspendAt,
			};
		}
	}
	cache.set(organizationId, { state, at: Date.now() });
	return state;
}

/** Distinct students (members with role student) with an active enrollment. */
export async function studentsUsed(organizationId: string): Promise<number> {
	const { rows } = await pool.query<{ used: string }>(
		`select count(distinct e.user_id) as used from catalog.enrollment e
		 join catalog.course c on c.id = e.course_id
		 join auth.member m on m."organizationId" = c.organization_id and m."userId" = e.user_id
		 where c.organization_id = $1 and e.status = 'active'
		   and (',' || m.role || ',') like '%,student,%'`,
		[organizationId],
	);
	return Number(rows[0]?.used ?? 0);
}

export type EnrollmentBlock = "suspended" | "trial-full" | null;

/** What the buyer or student sees when the academy cannot take them. */
export const ACADEMY_FULL_MESSAGE =
	"Esta academia no puede sumar alumnos en este momento.";

/** What the creator sees when enrolling someone by hand is refused. */
export function creatorBlockMessage(block: "suspended" | "trial-full"): string {
	return block === "suspended"
		? "Tu academia está suspendida por falta de pago y no puede sumar alumnos. Regularizá la suscripción en Facturación."
		: `Durante la prueba gratis tu academia puede tener hasta ${TRIAL_STUDENT_LIMIT} alumnos. El límite se levanta cuando termina la prueba y la suscripción está activa.`;
}

/**
 * Checked by every enrollment path (free, paid checkout, manual) before a new
 * enrollment. A person already counted as a student, or a staff member, never
 * takes a new place.
 */
export async function enrollmentBlock(
	organizationId: string,
	userId: string,
): Promise<EnrollmentBlock> {
	const state = await academyBillingState(organizationId);
	if (state.status === "suspended") return "suspended";
	if (state.status !== "trial") return null;
	const { rows } = await pool.query<{ enrolled: boolean; staff: boolean }>(
		`select
		   exists (select 1 from catalog.enrollment e join catalog.course c on c.id = e.course_id
		           where c.organization_id = $1 and e.user_id = $2 and e.status = 'active') as enrolled,
		   coalesce((select (',' || role || ',') not like '%,student,%' from auth.member
		             where "organizationId" = $1 and "userId" = $2 limit 1), false) as staff`,
		[organizationId, userId],
	);
	if (rows[0]?.enrolled || rows[0]?.staff) return null;
	return (await studentsUsed(organizationId)) >= TRIAL_STUDENT_LIMIT
		? "trial-full"
		: null;
}

// ------------------------------------------------------------ usage metering

/**
 * Writes one row per academy for `day` (YYYY-MM-DD) from the player-reported
 * playback usage and the stored video bytes. Safe to repeat: the stream numbers
 * are recomputed and the storage snapshot of the first run is kept.
 * Premium (DRM) usage from Phase 7 is added here in R7.
 */
export async function recordDailyUsage(day: string): Promise<void> {
	const config = billingConfig();
	const prices = {
		currency: config.currency,
		pricePerGbStream: config.pricePerGbStream,
		pricePerGbStorageMonth: config.pricePerGbStorageMonth,
	};
	await pool.query(
		`insert into billing.tenant_usage
		   (organization_id, day, storage_bytes, stream_bytes, plays, seconds_watched, provider_cost, unit_prices)
		 select o.id, $1::date, s.bytes, coalesce(u.bytes, 0), coalesce(u.plays, 0), coalesce(u.seconds, 0),
		   s.bytes::numeric / $2::numeric * $4::numeric / m.days
		     + coalesce(u.bytes, 0)::numeric / $2::numeric * $3::numeric,
		   $5::jsonb
		 from auth.organization o
		 cross join lateral (
		   select coalesce(sum(v.original_bytes), 0) as bytes from media.video v
		   where v.organization_id = o.id and v.status <> 'failed') s
		 cross join (select extract(day from date_trunc('month', $1::date) + interval '1 month - 1 day') as days) m
		 left join (
		   select organization_id, sum(bytes_served) as bytes, sum(plays) as plays, sum(seconds_watched) as seconds
		   from media.playback_usage where day = $1::date group by organization_id) u on u.organization_id = o.id
		 where o."createdAt" < $1::date + 1
		 on conflict (organization_id, day) do update set
		   stream_bytes = excluded.stream_bytes,
		   plays = excluded.plays,
		   seconds_watched = excluded.seconds_watched,
		   provider_cost = billing.tenant_usage.storage_bytes::numeric / $2::numeric * $4::numeric
		     / extract(day from date_trunc('month', $1::date) + interval '1 month - 1 day')
		     + excluded.stream_bytes::numeric / $2::numeric * $3::numeric,
		   unit_prices = excluded.unit_prices`,
		[
			day,
			GB,
			config.pricePerGbStream,
			config.pricePerGbStorageMonth,
			JSON.stringify(prices),
		],
	);
}

/** The last three complete days, so a worker that was down for a while catches up. */
export async function recordRecentUsage(): Promise<void> {
	const { rows } = await pool.query<{ day: string }>(
		`select to_char(current_date - g, 'YYYY-MM-DD') as day
		 from generate_series(3, 1, -1) g`,
	);
	for (const { day } of rows) await recordDailyUsage(day);
}

// ----------------------------------------------------------- monthly close

/**
 * Writes the invoice of `period` (YYYY-MM, default the previous month) for
 * every academy whose trial ended before the month did. Only the days after
 * the trial are billed, with the plan in force on the first of them (see
 * chargesFor). Idempotent per academy and period; a zero amount is born paid.
 * Returns the academies that got a new invoice.
 */
export async function closeMonth(period?: string): Promise<string[]> {
	const config = billingConfig();
	const { rows } = await pool.query<{
		id: string;
		period: string;
		from_day: string;
		to_day: string;
		billed_days: number;
		month_days: number;
		cost: string;
		stream_bytes: string;
		max_storage_bytes: string;
		plays: string;
		seconds_watched: string;
	}>(
		`with bounds as (
		   select p.period, to_date(p.period || '-01', 'YYYY-MM-DD') as start,
		     (to_date(p.period || '-01', 'YYYY-MM-DD') + interval '1 month')::date as stop
		   from (select coalesce($1, to_char(current_date - interval '1 month', 'YYYY-MM')) as period) p
		 ), academy as (
		   select o.id, b.period, b.start, b.stop,
		     greatest(b.start, (greatest(o."createdAt", $2::timestamptz) + make_interval(days => $3))::date) as from_day
		   from auth.organization o cross join bounds b
		   where greatest(o."createdAt", $2::timestamptz) + make_interval(days => $3) < b.stop
		     and b.stop <= current_date
		     and not exists (select 1 from billing.invoice i where i.organization_id = o.id and i.period = b.period)
		 )
		 select a.id, a.period, a.from_day::text, a.stop::text as to_day,
		   (a.stop - a.from_day) as billed_days, (a.stop - a.start) as month_days,
		   coalesce(sum(u.provider_cost), 0)::text as cost,
		   coalesce(sum(u.stream_bytes), 0)::text as stream_bytes,
		   coalesce(max(u.storage_bytes), 0)::text as max_storage_bytes,
		   coalesce(sum(u.plays), 0)::text as plays,
		   coalesce(sum(u.seconds_watched), 0)::text as seconds_watched
		 from academy a
		 left join billing.tenant_usage u
		   on u.organization_id = a.id and u.day >= a.from_day and u.day < a.stop
		 group by a.id, a.period, a.start, a.stop, a.from_day`,
		[period ?? null, billingStart(), TRIAL_DAYS],
	);

	const invoiced: string[] = [];
	for (const row of rows) {
		const plan = await planOn(row.id, row.from_day);
		const { amount, details: charges } = await chargesFor({
			organizationId: row.id,
			plan,
			from: row.from_day,
			stop: row.to_day,
			billedDays: row.billed_days,
			monthDays: row.month_days,
		});
		const details = {
			from: row.from_day,
			to: row.to_day,
			billedDays: row.billed_days,
			monthDays: row.month_days,
			...charges,
			// What the video cost the platform (informative, not charged).
			providerCost: Number(row.cost),
			usage: {
				streamBytes: Number(row.stream_bytes),
				maxStorageBytes: Number(row.max_storage_bytes),
				plays: Number(row.plays),
				secondsWatched: Number(row.seconds_watched),
			},
		};
		const { rowCount } = await pool.query(
			`insert into billing.invoice (organization_id, period, amount, currency, status, details, paid_at)
			 values ($1, $2, $3, $4, $5, $6, $7)
			 on conflict (organization_id, period) do nothing`,
			[
				row.id,
				row.period,
				amount,
				config.currency,
				amount === 0 ? "paid" : "open",
				JSON.stringify(details),
				amount === 0 ? new Date() : null,
			],
		);
		if (rowCount) invoiced.push(row.id);
	}
	return invoiced;
}

/**
 * An open invoice nobody charged (no subscription, or the charge never came)
 * counts as a failed payment after 35 days, so the grace period starts.
 */
export async function markUnchargedInvoices(): Promise<void> {
	const { rows } = await pool.query<{ organization_id: string }>(
		`update billing.invoice set status = 'failed', failed_at = now()
		 where status = 'open' and created_at < now() - interval '35 days'
		 returning organization_id`,
	);
	for (const row of rows) forgetBillingState(row.organization_id);
}

export type InvoiceView = {
	id: string;
	period: string;
	amount: number;
	currency: string;
	status: string;
	paidAt: string | null;
};

export async function listInvoices(
	organizationId: string,
): Promise<InvoiceView[]> {
	const { rows } = await pool.query<{
		id: string;
		period: string;
		amount: string;
		currency: string;
		status: string;
		paid_at: Date | null;
	}>(
		`select id, period, amount, currency, status, paid_at from billing.invoice
		 where organization_id = $1 order by period desc limit 24`,
		[organizationId],
	);
	return rows.map((row) => ({
		id: row.id,
		period: row.period,
		amount: Number(row.amount),
		currency: row.currency,
		status: row.status,
		paidAt: row.paid_at?.toISOString() ?? null,
	}));
}

/**
 * The current month so far, priced like its invoice will be: the full monthly
 * fee of the plan (minor units). `details.commission` carries the commission
 * already collected at each sale this month, for reference only.
 */
export async function monthlyEstimate(organizationId: string) {
	const { rows } = await pool.query<{
		from: string;
		stop: string;
		days: number;
	}>(
		`select date_trunc('month', current_date)::date::text as from,
		   (date_trunc('month', current_date) + interval '1 month')::date::text as stop,
		   extract(day from date_trunc('month', current_date) + interval '1 month - 1 day')::int as days`,
	);
	const month = rows[0];
	if (!month) throw new Error("No current month.");
	return chargesFor({
		organizationId,
		plan: await planOn(organizationId, month.from),
		from: month.from,
		stop: month.stop,
		billedDays: month.days,
		monthDays: month.days,
	});
}

// ------------------------------------------------------------------ dunning

/**
 * Queues the owner's emails through the outbox: one when the academy becomes
 * past due and one when it is suspended, once per unpaid episode (the dedupe
 * key holds the start of the episode).
 */
export async function queueBillingNotices(): Promise<void> {
	const { rows } = await pool.query<{ id: string }>(
		"select id from auth.organization",
	);
	for (const { id } of rows) {
		forgetBillingState(id);
		const state = await academyBillingState(id);
		if (!state.pastDueSince) continue;
		const since = state.pastDueSince.toISOString();
		await inTransaction(async (client) => {
			await emitEvent(
				client,
				"billing.past_due",
				{ organizationId: id, since },
				`billing.past_due:${id}:${since}`,
			);
			if (state.status === "suspended") {
				await emitEvent(
					client,
					"billing.suspended",
					{ organizationId: id, since },
					`billing.suspended:${id}:${since}`,
				);
			}
		});
	}
}

/** Sends a queued notice to the academy owner, unless it was paid meanwhile. */
export async function sendBillingNotice(
	kind: "past_due" | "suspended",
	organizationId: string,
): Promise<void> {
	forgetBillingState(organizationId);
	const state = await academyBillingState(organizationId);
	// Only the notice that matches the state now (a suspended academy gets the suspension one).
	if (state.status !== kind) return;
	const { rows } = await pool.query<{
		name: string;
		slug: string;
		email: string;
	}>(
		`select o.name, o.slug, u.email from auth.organization o
		 join auth.member m on m."organizationId" = o.id and (',' || m.role || ',') like '%,owner,%'
		 join auth."user" u on u.id = m."userId"
		 where o.id = $1 order by m."createdAt" limit 1`,
		[organizationId],
	);
	const owner = rows[0];
	if (!owner) return;
	const url = `${tenantOrigin(owner.slug)}/panel/facturacion`;
	const date = state.suspendAt?.toLocaleDateString("es-AR") ?? "";
	const subject =
		kind === "suspended"
			? `Tu academia ${owner.name} está suspendida por falta de pago`
			: `Hay un pago pendiente de tu academia ${owner.name}`;
	const body =
		kind === "suspended"
			? "Tu academia quedó suspendida porque no pudimos cobrar la suscripción. Tus alumnos siguen estudiando, pero no podés sumar alumnos ni vender cursos hasta regularizar el pago. No borramos nada."
			: `No pudimos cobrar la suscripción de tu academia (o todavía no está activa). Regularizala antes del ${date} para evitar la suspensión. Mercado Pago reintenta el cobro automáticamente.`;
	await sendPlatformEmail({
		to: owner.email,
		subject,
		text: `${body}\n\nFacturación: ${url}`,
		html: `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(url)}">Ir a Facturación</a></p>`,
	});
}

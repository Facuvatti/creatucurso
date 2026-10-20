// Mercado Pago marketplace (ADR-0023): the platform owns one application and
// every academy links its seller account to it with OAuth (authorization code
// + PKCE). This file holds the OAuth attempt, the stored tokens and their
// renewal. Payments, preferences and refunds use the academy's own token
// through `withSellerToken`.
import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { pool } from "../../server/db.server.ts";
import { appOrigin } from "../../server/origins.server.ts";
import {
	decryptSecret,
	encryptSecret,
} from "../../shared/crypto/secret-box.ts";
import { findRoles } from "../identity/members.ts";
import { resolveTenant } from "../tenancy/tenants.ts";
import {
	describeError,
	exchangeAuthorizationCode,
	MercadoPagoError,
	refreshAccessToken,
} from "./mercadopago.ts";

const STATE_MINUTES = 10;
/** A token that expires within this window is renewed before it is used. */
const USE_MARGIN_MS = 5 * 60 * 1000;
/** The worker renews tokens that expire within this many days. */
const RENEW_DAYS = 30;

/** The academy's connection was revoked or lost: it cannot charge until it reconnects. */
export class MercadoPagoDisconnected extends Error {
	constructor() {
		super("Mercado Pago is disconnected for this academy.");
		this.name = "MercadoPagoDisconnected";
	}
}

function secretsKey(): string {
	const key = process.env.SECRETS_ENCRYPTION_KEY;
	if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required.");
	return key;
}

/** Fixed address Mercado Pago sends the seller back to (set it in the application). */
export function callbackUrl(): string {
	return `${appOrigin()}/api/mercadopago/callback`;
}

// ------------------------------------------------------------ state and PKCE

/** The state is signed with a key derived from SECRETS_ENCRYPTION_KEY. */
function stateKey(): Buffer {
	return createHmac("sha256", secretsKey())
		.update("mercadopago-oauth-state")
		.digest();
}

type StatePayload = {
	organizationId: string;
	userId: string;
	nonce: string;
	expiresAt: number;
};

function signState(payload: StatePayload): string {
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = createHmac("sha256", stateKey())
		.update(body)
		.digest("base64url");
	return `${body}.${signature}`;
}

/** The payload of a state we signed and that has not expired, or null. */
function verifyState(state: string): StatePayload | null {
	const [body, signature, extra] = state.split(".");
	if (!body || !signature || extra !== undefined) return null;
	const expected = createHmac("sha256", stateKey())
		.update(body)
		.digest("base64url");
	const received = Buffer.from(signature);
	const wanted = Buffer.from(expected);
	if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) {
		return null;
	}
	try {
		const payload = JSON.parse(
			Buffer.from(body, "base64url").toString("utf8"),
		) as Partial<StatePayload>;
		if (
			typeof payload.organizationId !== "string" ||
			typeof payload.userId !== "string" ||
			typeof payload.nonce !== "string" ||
			typeof payload.expiresAt !== "number" ||
			payload.expiresAt < Date.now()
		) {
			return null;
		}
		return payload as StatePayload;
	} catch {
		return null;
	}
}

const hashState = (state: string) =>
	createHash("sha256").update(state).digest("hex");

/** The academy's own origin, so the callback can send the owner back to it. */
async function isOriginOf(
	organizationId: string,
	origin: string,
): Promise<boolean> {
	try {
		const host = await resolveTenant(new URL(origin).host);
		return host.kind === "tenant" && host.tenant.id === organizationId;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------- connecting

/** Creates the single-use OAuth attempt and returns the Mercado Pago page to send the owner to. */
export async function startConnection(input: {
	organizationId: string;
	userId: string;
	returnOrigin: string;
}): Promise<string> {
	const clientId = process.env.MP_CLIENT_ID;
	if (!clientId) throw new Error("MP_CLIENT_ID is required.");
	if (!(await isOriginOf(input.organizationId, input.returnOrigin))) {
		throw new Error("The return address does not belong to this academy.");
	}

	// 64 random bytes give 86 characters, inside the 43-128 PKCE range.
	const codeVerifier = randomBytes(64).toString("base64url");
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	const expiresAt = Date.now() + STATE_MINUTES * 60 * 1000;
	const state = signState({
		organizationId: input.organizationId,
		userId: input.userId,
		nonce: randomBytes(16).toString("base64url"),
		expiresAt,
	});

	await pool.query(
		"delete from payments.mercadopago_oauth_state where expires_at < now()",
	);
	await pool.query(
		`insert into payments.mercadopago_oauth_state
		 (state_hash, organization_id, user_id, code_verifier_encrypted, return_origin, expires_at)
		 values ($1, $2, $3, $4, $5, $6)`,
		[
			hashState(state),
			input.organizationId,
			input.userId,
			encryptSecret(codeVerifier, secretsKey()),
			input.returnOrigin,
			new Date(expiresAt),
		],
	);

	const url = new URL(
		process.env.MP_AUTH_URL || "https://auth.mercadopago.com/authorization",
	);
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("platform_id", "mp");
	url.searchParams.set("redirect_uri", callbackUrl());
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	return url.toString();
}

/** Why a connection failed; the panel shows a Spanish message for each code. */
export type ConnectionFailure =
	| "expired"
	| "session"
	| "role"
	| "exchange"
	| "duplicate"
	| "save";

export type ConnectionResult =
	| { ok: true; returnOrigin: string }
	| { ok: false; reason: ConnectionFailure; returnOrigin: string | null };

/**
 * Finishes the OAuth attempt: the state is consumed (single use), the person
 * must be the one who started it and still be owner or admin, and only then
 * is the code exchanged for tokens.
 */
export async function completeConnection(input: {
	state: string;
	code: string;
	sessionUserId: string | null;
}): Promise<ConnectionResult> {
	const payload = verifyState(input.state);
	if (!payload) return { ok: false, reason: "expired", returnOrigin: null };

	// Deleting the row is what makes the state single use, even across servers.
	const { rows } = await pool.query<{
		organization_id: string;
		user_id: string;
		code_verifier_encrypted: string;
		return_origin: string;
		expires_at: Date;
	}>(
		`delete from payments.mercadopago_oauth_state where state_hash = $1
		 returning organization_id, user_id, code_verifier_encrypted, return_origin, expires_at`,
		[hashState(input.state)],
	);
	const stored = rows[0];
	if (
		!stored ||
		stored.expires_at.getTime() < Date.now() ||
		stored.organization_id !== payload.organizationId ||
		stored.user_id !== payload.userId
	) {
		return { ok: false, reason: "expired", returnOrigin: null };
	}
	// The origin was validated when the attempt started; check again before using it.
	const returnOrigin = (await isOriginOf(
		stored.organization_id,
		stored.return_origin,
	))
		? stored.return_origin
		: null;
	const fail = (reason: ConnectionFailure): ConnectionResult => ({
		ok: false,
		reason,
		returnOrigin,
	});

	if (!input.sessionUserId || input.sessionUserId !== stored.user_id) {
		return fail("session");
	}
	const roles = await findRoles(stored.organization_id, stored.user_id);
	if (!roles.includes("owner") && !roles.includes("admin")) {
		return fail("role");
	}

	let tokens: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
	try {
		tokens = await exchangeAuthorizationCode({
			code: input.code,
			redirectUri: callbackUrl(),
			codeVerifier: decryptSecret(stored.code_verifier_encrypted, secretsKey()),
		});
	} catch (error) {
		logError("Mercado Pago code exchange failed", error, {
			organizationId: stored.organization_id,
		});
		return fail("exchange");
	}

	const client = await pool.connect();
	try {
		await client.query("begin");
		// A seller that an academy released can be linked by another one.
		await client.query(
			`delete from payments.mercadopago_connection
			 where mp_user_id = $1 and organization_id <> $2 and status = 'disconnected'`,
			[tokens.userId, stored.organization_id],
		);
		await client.query(
			`insert into payments.mercadopago_connection
			 (organization_id, mp_user_id, access_token_encrypted, refresh_token_encrypted,
			  public_key, expires_at, status, status_reason, refresh_attempts, connected_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 'connected', null, 0, now(), now())
			 on conflict (organization_id) do update set
			   mp_user_id = excluded.mp_user_id,
			   access_token_encrypted = excluded.access_token_encrypted,
			   refresh_token_encrypted = excluded.refresh_token_encrypted,
			   public_key = excluded.public_key,
			   expires_at = excluded.expires_at,
			   status = 'connected', status_reason = null, refresh_attempts = 0,
			   connected_at = now(), updated_at = now()`,
			[
				stored.organization_id,
				tokens.userId,
				encryptSecret(tokens.accessToken, secretsKey()),
				tokens.refreshToken
					? encryptSecret(tokens.refreshToken, secretsKey())
					: null,
				tokens.publicKey,
				tokens.expiresAt,
			],
		);
		// The OAuth connection takes over from pasted credentials (or another provider).
		await client.query(
			"delete from payments.merchant where organization_id = $1",
			[stored.organization_id],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		if ((error as { code?: string }).code === "23505") {
			return fail("duplicate");
		}
		logError("Saving the Mercado Pago connection failed", error, {
			organizationId: stored.organization_id,
		});
		return fail("save");
	} finally {
		client.release();
	}
	return { ok: true, returnOrigin: stored.return_origin };
}

// ------------------------------------------------------------------- status

export type ConnectionStatus = "connected" | "disconnected" | "error";

export async function findConnection(organizationId: string): Promise<{
	mpUserId: string;
	status: ConnectionStatus;
} | null> {
	const { rows } = await pool.query<{
		mp_user_id: string;
		status: ConnectionStatus;
	}>(
		"select mp_user_id, status from payments.mercadopago_connection where organization_id = $1",
		[organizationId],
	);
	return rows[0]
		? { mpUserId: rows[0].mp_user_id, status: rows[0].status }
		: null;
}

/** The academy a Mercado Pago seller (notification `user_id`) is linked to. */
export async function findOrganizationByMpUser(
	mpUserId: string,
): Promise<string | null> {
	const { rows } = await pool.query<{ organization_id: string }>(
		"select organization_id from payments.mercadopago_connection where mp_user_id = $1",
		[mpUserId],
	);
	return rows[0]?.organization_id ?? null;
}

/** Forgets the tokens. The reason never holds token material. */
export async function markDisconnected(
	organizationId: string,
	reason: string,
): Promise<void> {
	await pool.query(
		`update payments.mercadopago_connection
		 set status = 'disconnected', status_reason = $2, access_token_encrypted = null,
		     refresh_token_encrypted = null, updated_at = now()
		 where organization_id = $1`,
		[organizationId, reason],
	);
	logDisconnected(organizationId, reason);
}

function logDisconnected(organizationId: string, reason: string): void {
	console.error(
		JSON.stringify({
			level: "error",
			msg: "Mercado Pago disconnected",
			organizationId,
			reason,
		}),
	);
}

/** The academy disconnects by itself. Mercado Pago has no revocation call, so the app stays authorized on their side. */
export function disconnect(organizationId: string) {
	return markDisconnected(organizationId, "Disconnected by the academy");
}

function logError(
	msg: string,
	error: unknown,
	ids: Record<string, string>,
): void {
	console.error(
		JSON.stringify({
			level: "error",
			msg,
			...ids,
			error: describeError(error),
		}),
	);
}

// ------------------------------------------------------------------- renewal

/**
 * Renews the academy's tokens (Mercado Pago rotates the refresh token, so both
 * are stored in the same transaction under a row lock). With `skipLocked` a
 * row someone else is renewing is left alone and null is returned. With
 * `staleToken`, a token that was already replaced by someone else is returned
 * without calling Mercado Pago again. Throws MercadoPagoDisconnected when
 * Mercado Pago rejects the refresh token.
 */
async function renew(
	organizationId: string,
	options: { skipLocked: boolean; staleToken?: string },
): Promise<string | null> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const { rows } = await client.query<{
			access_token_encrypted: string | null;
			refresh_token_encrypted: string | null;
			expires_at: Date | null;
		}>(
			`select access_token_encrypted, refresh_token_encrypted, expires_at
			 from payments.mercadopago_connection
			 where organization_id = $1 and status <> 'disconnected'
			 for update ${options.skipLocked ? "skip locked" : ""}`,
			[organizationId],
		);
		const row = rows[0];
		if (!row?.access_token_encrypted) {
			await client.query("commit");
			return null;
		}
		const current = decryptSecret(row.access_token_encrypted, secretsKey());
		if (options.staleToken && current !== options.staleToken) {
			await client.query("commit");
			return current;
		}
		const expired = !row.expires_at || row.expires_at.getTime() < Date.now();

		const disconnectNow = async (reason: string) => {
			await client.query(
				`update payments.mercadopago_connection
				 set status = 'disconnected', status_reason = $2, access_token_encrypted = null,
				     refresh_token_encrypted = null, updated_at = now()
				 where organization_id = $1`,
				[organizationId, reason],
			);
			await client.query("commit");
			logDisconnected(organizationId, reason);
			throw new MercadoPagoDisconnected();
		};

		if (!row.refresh_token_encrypted) {
			if (expired) return disconnectNow("Token expired and no refresh token");
			await client.query("commit");
			return current;
		}

		try {
			const tokens = await refreshAccessToken(
				decryptSecret(row.refresh_token_encrypted, secretsKey()),
			);
			await client.query(
				`update payments.mercadopago_connection
				 set access_token_encrypted = $2, refresh_token_encrypted = $3, expires_at = $4,
				     status = 'connected', status_reason = null, refresh_attempts = 0,
				     updated_at = now()
				 where organization_id = $1`,
				[
					organizationId,
					encryptSecret(tokens.accessToken, secretsKey()),
					tokens.refreshToken
						? encryptSecret(tokens.refreshToken, secretsKey())
						: row.refresh_token_encrypted,
					tokens.expiresAt,
				],
			);
			await client.query("commit");
			return tokens.accessToken;
		} catch (error) {
			if (error instanceof MercadoPagoDisconnected) throw error;
			const rejected =
				error instanceof MercadoPagoError &&
				[400, 401, 403].includes(error.status);
			if (rejected) {
				return disconnectNow(`Refresh rejected: ${describeError(error)}`);
			}
			// Network or 5xx: keep the connection and try again on the next run.
			if (expired) return disconnectNow("Token expired and refresh failed");
			await client.query(
				`update payments.mercadopago_connection
				 set status = 'error', status_reason = $2, refresh_attempts = refresh_attempts + 1,
				     updated_at = now()
				 where organization_id = $1`,
				[organizationId, `Refresh failed: ${describeError(error)}`],
			);
			await client.query("commit");
			logError("Mercado Pago refresh failed", error, { organizationId });
			throw error;
		}
	} catch (error) {
		await client.query("rollback").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}

/** Worker job: renews the connections whose token expires within 30 days. */
export async function renewExpiringConnections(): Promise<void> {
	const { rows } = await pool.query<{ organization_id: string }>(
		`select organization_id from payments.mercadopago_connection
		 where status in ('connected', 'error') and expires_at < now() + make_interval(days => $1)`,
		[RENEW_DAYS],
	);
	for (const { organization_id: organizationId } of rows) {
		try {
			await renew(organizationId, { skipLocked: true });
		} catch (error) {
			// Already recorded on the connection; the next run retries transient failures.
			if (!(error instanceof MercadoPagoDisconnected)) {
				logError("Renewing a Mercado Pago connection failed", error, {
					organizationId,
				});
			}
		}
	}
}

// ----------------------------------------------------------------------- use

/**
 * Runs a Mercado Pago call with the academy's token. The token is renewed
 * first when it expires within 5 minutes; on a 401 it is renewed once and the
 * call repeated once; a 403, or a second 401, disconnects the academy.
 */
export async function withSellerToken<T>(
	organizationId: string,
	run: (accessToken: string) => Promise<T>,
): Promise<T> {
	const { rows } = await pool.query<{
		access_token_encrypted: string | null;
		expires_at: Date | null;
	}>(
		`select access_token_encrypted, expires_at from payments.mercadopago_connection
		 where organization_id = $1 and status <> 'disconnected'`,
		[organizationId],
	);
	const row = rows[0];
	if (!row?.access_token_encrypted) throw new MercadoPagoDisconnected();
	let token = decryptSecret(row.access_token_encrypted, secretsKey());

	if (
		!row.expires_at ||
		row.expires_at.getTime() < Date.now() + USE_MARGIN_MS
	) {
		try {
			token = (await renew(organizationId, { skipLocked: false })) ?? token;
		} catch (error) {
			// A transient failure is fine while the token still works.
			if (
				error instanceof MercadoPagoDisconnected ||
				!row.expires_at ||
				row.expires_at.getTime() < Date.now()
			) {
				throw error instanceof MercadoPagoDisconnected
					? error
					: new MercadoPagoDisconnected();
			}
		}
	}

	try {
		return await run(token);
	} catch (error) {
		if (!(error instanceof MercadoPagoError)) throw error;
		if (error.status === 403) {
			await markDisconnected(organizationId, "Mercado Pago answered 403");
			throw new MercadoPagoDisconnected();
		}
		if (error.status !== 401) throw error;
	}

	// 401: one renewal, one retry.
	const fresh = await renew(organizationId, {
		skipLocked: false,
		staleToken: token,
	});
	if (!fresh) throw new MercadoPagoDisconnected();
	try {
		return await run(fresh);
	} catch (error) {
		if (
			error instanceof MercadoPagoError &&
			[401, 403].includes(error.status)
		) {
			await markDisconnected(
				organizationId,
				`Mercado Pago answered ${error.status} after a renewal`,
			);
			throw new MercadoPagoDisconnected();
		}
		throw error;
	}
}

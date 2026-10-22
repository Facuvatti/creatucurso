-- >>> better-auth generated (do not edit by hand; run `pnpm db:auth`) >>>
create schema if not exists "auth";

create table "auth"."user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "role" text, "banned" boolean, "banReason" text, "banExpires" timestamptz, "twoFactorEnabled" boolean, "isCreator" boolean);

create table "auth"."session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth"."user" ("id") on delete cascade, "activeOrganizationId" text, "impersonatedBy" text);

create table "auth"."account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth"."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "auth"."verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "auth"."organization" ("id" text not null primary key, "name" text not null, "slug" text not null unique, "logo" text, "createdAt" timestamptz not null, "metadata" text, "customDomain" text unique, "customDomainVerifiedAt" timestamptz, "hyperswitchMerchantId" text, "hyperswitchProfileId" text, "videoPlan" text not null, "drmLibraryId" text);

create table "auth"."member" ("id" text not null primary key, "organizationId" text not null references "auth"."organization" ("id") on delete cascade, "userId" text not null references "auth"."user" ("id") on delete cascade, "role" text not null, "createdAt" timestamptz not null);

create table "auth"."invitation" ("id" text not null primary key, "organizationId" text not null references "auth"."organization" ("id") on delete cascade, "email" text not null, "role" text, "status" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "inviterId" text not null references "auth"."user" ("id") on delete cascade);

create table "auth"."twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "auth"."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

create index "session_userId_idx" on "auth"."session" ("userId");

create index "account_userId_idx" on "auth"."account" ("userId");

create index "verification_identifier_idx" on "auth"."verification" ("identifier");

create index "member_organizationId_idx" on "auth"."member" ("organizationId");

create index "member_userId_idx" on "auth"."member" ("userId");

create index "invitation_organizationId_idx" on "auth"."invitation" ("organizationId");

create index "invitation_email_idx" on "auth"."invitation" ("email");

create index "twoFactor_secret_idx" on "auth"."twoFactor" ("secret");

create index "twoFactor_userId_idx" on "auth"."twoFactor" ("userId");
-- <<< better-auth generated <<<

-- Our additions to better-auth tables (outside the generated section above)
alter table auth.organization alter column "videoPlan" set default 'basic';

-- Our tables: catalog (courses, modules, lessons, enrollments and progress) -------------
create schema if not exists catalog;

create table if not exists catalog.course (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	slug text not null,
	previous_slugs text[] not null default '{}',
	name text not null,
	short_description text,
	long_description text,
	cover_images jsonb not null default '[]'::jsonb,
	promo_video jsonb,
	requirements text[] not null default '{}',
	learning_goals text[] not null default '{}',
	target_students text[] not null default '{}',
	price_amount integer check (price_amount >= 0),
	currency text,
	status text not null default 'draft' check (status in ('draft', 'published')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (organization_id, slug)
);
create index if not exists course_organization_idx on catalog.course (organization_id, status);
create index if not exists course_previous_slugs_idx on catalog.course using gin (previous_slugs);

create table if not exists catalog.course_instructor (
	course_id uuid not null references catalog.course (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	primary key (course_id, user_id)
);

create table if not exists catalog.module (
	id uuid primary key default gen_random_uuid(),
	course_id uuid not null references catalog.course (id) on delete cascade,
	title text not null,
	description text,
	position integer not null check (position > 0)
);
create index if not exists module_course_idx on catalog.module (course_id, position);

create table if not exists catalog.lesson (
	id uuid primary key default gen_random_uuid(),
	course_id uuid not null references catalog.course (id) on delete cascade,
	module_id uuid not null references catalog.module (id) on delete cascade,
	slug text not null,
	title text not null,
	description text,
	position integer not null check (position > 0),
	videos jsonb not null default '[]'::jsonb,
	notes jsonb not null default '[]'::jsonb,
	unique (course_id, slug)
);
create index if not exists lesson_module_idx on catalog.lesson (module_id, position);

create type catalog.source_type as enum ('manual', 'payment', 'free');
-- Only 'active' grants access to the course.
create type catalog.enrollment_status as enum ('active', 'suspended', 'refunded', 'revoked');

create table if not exists catalog.enrollment (
	id uuid primary key default gen_random_uuid(),
	course_id uuid not null references catalog.course (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	source catalog.source_type not null default 'manual',
	status catalog.enrollment_status not null default 'active',
	payment_id text unique,
	completed_at timestamptz,
	created_at timestamptz not null default now(),
	unique (course_id, user_id)
);
create index if not exists enrollment_user_idx on catalog.enrollment (user_id);

create table if not exists catalog.lesson_progress (
	lesson_id uuid not null references catalog.lesson (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	completed_at timestamptz not null default now(),
	primary key (lesson_id, user_id)
);

-- Our tables: exams (form exams graded instantly; ADR-0033) -----------------------------
-- The answer key (option.correct, accepted_answer) is read only by the server. Student
-- queries never select it before the attempt is submitted.
create schema if not exists exams;

create table if not exists exams.exam (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	course_id uuid not null references catalog.course (id) on delete cascade,
	module_id uuid references catalog.module (id) on delete set null,
	title text not null,
	passing_score integer not null default 60 check (passing_score between 0 and 100),
	max_attempts integer check (max_attempts > 0),
	time_limit_seconds integer check (time_limit_seconds > 0),
	shuffle_questions boolean not null default false,
	shuffle_options boolean not null default false,
	show_answers_after boolean not null default false,
	required boolean not null default false,
	published boolean not null default false,
	created_at timestamptz not null default now()
);
create index if not exists exam_course_idx on exams.exam (course_id);

create table if not exists exams.question (
	id uuid primary key default gen_random_uuid(),
	exam_id uuid not null references exams.exam (id) on delete cascade,
	position integer not null check (position > 0),
	kind text not null check (kind in ('single', 'multiple', 'truefalse', 'short_text', 'numeric')),
	prompt text not null,
	points integer not null default 1 check (points > 0)
);
create index if not exists question_exam_idx on exams.question (exam_id, position);

-- Choices of single / multiple / truefalse questions.
create table if not exists exams.option (
	id uuid primary key default gen_random_uuid(),
	question_id uuid not null references exams.question (id) on delete cascade,
	position integer not null check (position > 0),
	text text not null,
	correct boolean not null default false
);
create index if not exists option_question_idx on exams.option (question_id, position);

-- Answer key of short_text (value) and numeric (value + tolerance) questions.
create table if not exists exams.accepted_answer (
	id uuid primary key default gen_random_uuid(),
	question_id uuid not null references exams.question (id) on delete cascade,
	value text not null,
	numeric_tolerance numeric check (numeric_tolerance >= 0)
);
create index if not exists accepted_answer_question_idx on exams.accepted_answer (question_id);

-- layout: the shuffled order of this attempt ({"questions": [ids], "options": {questionId: [ids]}}),
-- stored so a reload shows the same order. answers: {questionId: [optionIds] | "text"}.
-- expired: submitted after the time limit; it scores 0 and cannot pass.
create table if not exists exams.attempt (
	id uuid primary key default gen_random_uuid(),
	exam_id uuid not null references exams.exam (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	started_at timestamptz not null default now(),
	submitted_at timestamptz,
	score integer check (score between 0 and 100),
	passed boolean,
	expired boolean not null default false,
	layout jsonb not null default '{}'::jsonb,
	answers jsonb not null default '{}'::jsonb
);
create index if not exists attempt_exam_user_idx on exams.attempt (exam_id, user_id);
-- At most one open attempt per student and exam (also guards a double click on "Empezar").
create unique index if not exists attempt_one_open_idx on exams.attempt (exam_id, user_id) where submitted_at is null;

-- Our tables: payments (per-academy gateway account and each payment) -----------------
create schema if not exists payments;

create table if not exists payments.merchant (
	organization_id text primary key references auth.organization (id) on delete cascade,
	provider text not null default 'hyperswitch' check (provider in ('hyperswitch', 'mercadopago')),
	-- Mercado Pago: seller user id; profile and publishable key stay null.
	gateway_merchant_id text not null,
	gateway_profile_id text,
	publishable_key text,
	-- Mercado Pago: the seller's access token.
	api_key_encrypted text not null,
	webhook_secret_encrypted text not null,
	created_at timestamptz not null default now()
);

-- Mercado Pago marketplace (ADR-0023): one row per academy linked by OAuth.
create table if not exists payments.mercadopago_connection (
	organization_id text primary key references auth.organization (id) on delete cascade,
	-- The seller's Mercado Pago user id; webhooks carry it and map to the academy.
	mp_user_id text not null unique,
	-- Both encrypted with the secret box; null once disconnected.
	access_token_encrypted text,
	refresh_token_encrypted text,
	public_key text,
	expires_at timestamptz,
	status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
	-- Never holds token material.
	status_reason text,
	refresh_attempts integer not null default 0,
	connected_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- Single-use state of an OAuth attempt in flight (the PKCE verifier is encrypted).
create table if not exists payments.mercadopago_oauth_state (
	state_hash text primary key,
	organization_id text not null references auth.organization (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	code_verifier_encrypted text not null,
	return_origin text not null,
	expires_at timestamptz not null
);

create table if not exists payments.payment (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	course_id uuid not null,
	user_id text not null references auth."user" (id) on delete cascade,
	provider text not null default 'hyperswitch' check (provider in ('hyperswitch', 'mercadopago')),
	-- Hyperswitch: its payment id. Mercado Pago: the preference id.
	gateway_payment_id text not null unique,
	-- Mercado Pago payment id, known once the student paid (refunds use it).
	provider_payment_id text,
	amount integer not null check (amount > 0),
	currency text not null,
	refunded_amount integer not null default 0 check (refunded_amount >= 0),
	-- Platform commission charged at sale time via Mercado Pago marketplace_fee (ADR-0029).
	-- The amount charged on the original sale; Mercado Pago reverses it proportionally on a
	-- refund, so this stays the historical as-charged figure. 0 for flat plan and legacy sales.
	commission_amount integer not null default 0 check (commission_amount >= 0),
	status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);
create index if not exists payment_user_course_idx on payments.payment (user_id, course_id);
create index if not exists payment_provider_payment_idx on payments.payment (provider_payment_id);

create table if not exists payments.refund (
	id uuid primary key default gen_random_uuid(),
	payment_id uuid not null references payments.payment (id) on delete cascade,
	provider_refund_id text not null,
	amount integer not null check (amount > 0),
	-- 'student' (self-service), 'tenant' (owner or admin) or 'provider' (done outside the app).
	requested_by text not null default 'provider',
	created_at timestamptz not null default now(),
	unique (payment_id, provider_refund_id)
);

create table if not exists payments.dispute (
	id uuid primary key default gen_random_uuid(),
	payment_id uuid not null references payments.payment (id) on delete cascade,
	provider_dispute_id text not null,
	status text not null check (status in ('open', 'won', 'lost')),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (payment_id, provider_dispute_id)
);

-- Transactional outbox: written in the same transaction as the change, delivered by the worker.
create schema if not exists events;

create table if not exists events.outbox (
	id bigint generated always as identity primary key,
	type text not null,
	payload jsonb not null,
	-- Idempotency: the same business fact is written once.
	dedupe_key text not null unique,
	created_at timestamptz not null default now(),
	available_at timestamptz not null default now(),
	attempts integer not null default 0,
	delivered_at timestamptz,
	last_error text
);
create index if not exists outbox_pending_idx on events.outbox (available_at) where delivered_at is null;

-- Our tables: community (public reviews and lesson comments) ---------------------------
create schema if not exists community;

create table if not exists community.review (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	course_id uuid not null,
	user_id text not null references auth."user" (id) on delete cascade,
	rating smallint not null check (rating between 1 and 5),
	body text not null default '' check (length(body) <= 2000),
	hidden boolean not null default false,
	-- Why it is hidden: a refund hide is undone when the enrollment is active again; a moderation hide is not.
	hidden_reason text check (hidden_reason in ('moderation', 'refund')),
	-- One public reply from the academy per review.
	reply_body text check (length(reply_body) <= 2000),
	reply_user_id text references auth."user" (id) on delete set null,
	reply_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (course_id, user_id)
);
create index if not exists review_course_idx on community.review (course_id, hidden, created_at desc);
create index if not exists review_organization_idx on community.review (organization_id, hidden, created_at desc);

create table if not exists community.comment (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	course_id uuid not null,
	lesson_id uuid not null,
	user_id text not null references auth."user" (id) on delete cascade,
	parent_id uuid references community.comment (id) on delete cascade,
	body text not null check (length(body) between 1 and 10000),
	hidden boolean not null default false,
	answered boolean not null default false,
	pinned boolean not null default false,
	-- Moderation delete: a tombstone stays in the thread so replies do not break.
	deleted_at timestamptz,
	created_at timestamptz not null default now()
);
create index if not exists comment_lesson_idx on community.comment (lesson_id, created_at);
create index if not exists comment_course_idx on community.comment (course_id, created_at);

-- One report per person and comment; the moderation queue lists comments with open reports.
create table if not exists community.comment_report (
	comment_id uuid not null references community.comment (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (comment_id, user_id)
);

-- Students the academy silenced in comments (reviews are not affected).
create table if not exists community.comment_mute (
	organization_id text not null references auth.organization (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (organization_id, user_id)
);

-- Our tables: tenancy (custom domain state; ADR-0024) -----------------------------------
create schema if not exists tenancy;

-- One row per organization with a custom domain. The creator proves ownership with a
-- CNAME to our fallback origin; then the Cloudflare custom hostname issues the certificate.
create table if not exists tenancy.domain_check (
	organization_id text primary key references auth.organization (id) on delete cascade,
	cloudflare_hostname_id text,
	status text not null default 'pending_dns'
		check (status in ('pending_dns', 'issuing_certificate', 'active', 'error')),
	status_reason text,
	last_checked_at timestamptz,
	created_at timestamptz not null default now()
);
-- subdomain = CNAME (cursos.maria.com); apex = A record (maria.com), ADR-0031.
alter table tenancy.domain_check add column if not exists kind text not null default 'subdomain'
	check (kind in ('subdomain', 'apex'));

-- Single-use state of a Domain Connect attempt in flight (ADR-0030): the owner was
-- sent to their DNS provider to apply our CNAME template and comes back with it.
create table if not exists tenancy.domain_connect_state (
	state_hash text primary key,
	organization_id text not null references auth.organization (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	domain text not null,
	return_origin text not null,
	expires_at timestamptz not null
);

-- Our tables: media (Basic-tier video: upload, encoding, playback; ADR-0020) -------------
create schema if not exists media;

-- One video per lesson. `status` is also the encoder's queue: it takes the
-- oldest 'uploaded' row with FOR UPDATE SKIP LOCKED. Quota is counted from original_bytes.
create table if not exists media.video (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	lesson_id uuid unique references catalog.lesson (id) on delete set null,
	uploaded_by text references auth."user" (id) on delete set null,
	status text not null default 'uploading'
		check (status in ('uploading', 'uploaded', 'encoding', 'ready', 'failed')),
	error text,
	original_path text,
	original_bytes bigint not null check (original_bytes > 0),
	duration_seconds integer,
	width integer,
	height integer,
	renditions integer[] not null default '{}',
	key_encrypted text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	original_delete_after timestamptz
);
create index if not exists video_organization_idx on media.video (organization_id);
create index if not exists video_queue_idx on media.video (status, created_at);

-- A playback that counts against the concurrent-stream cap while last_seen_at is recent.
create table if not exists media.playback_session (
	id uuid primary key default gen_random_uuid(),
	video_id uuid not null references media.video (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	started_at timestamptz not null default now(),
	last_seen_at timestamptz not null default now()
);
create index if not exists playback_session_seen_idx on media.playback_session (last_seen_at);
create index if not exists playback_session_video_user_idx on media.playback_session (video_id, user_id);

-- Daily usage per video, read by tenant billing (Phase 8). Bytes and seconds are
-- reported by the player; nginx access logs stay the authoritative source of bytes.
create table if not exists media.playback_usage (
	video_id uuid not null references media.video (id) on delete cascade,
	organization_id text not null references auth.organization (id) on delete cascade,
	day date not null default current_date,
	plays integer not null default 0,
	seconds_watched bigint not null default 0,
	bytes_served bigint not null default 0,
	primary key (video_id, day)
);
create index if not exists playback_usage_organization_idx on media.playback_usage (organization_id, day);

-- Our tables: billing (usage, trial, invoices and subscription of the academies; ADR-0029) --
create schema if not exists billing;

-- One row per academy and day, written by the worker (upsert, so a re-run changes nothing).
-- Raw units plus the unit prices used, so a later price change does not rewrite history.
-- provider_cost is what the day cost the platform, in ARS (major units). Premium (DRM) usage is added in R7.
create table if not exists billing.tenant_usage (
	organization_id text not null references auth.organization (id) on delete cascade,
	day date not null,
	storage_bytes bigint not null default 0,
	stream_bytes bigint not null default 0,
	plays integer not null default 0,
	seconds_watched bigint not null default 0,
	provider_cost numeric(14, 4) not null default 0,
	unit_prices jsonb not null,
	primary key (organization_id, day)
);

-- The academy's plan (docs/planes_suscripcion.md): commission, hybrid or flat. No row = commission.
-- A change takes effect on effective_from (the next month; the current one during the trial).
create table if not exists billing.academy_plan (
	organization_id text not null references auth.organization (id) on delete cascade,
	effective_from date not null,
	plan text not null check (plan in ('commission', 'hybrid', 'flat')),
	created_at timestamptz not null default now(),
	primary key (organization_id, effective_from)
);

-- One invoice per academy and month (amount in minor units). Zero-amount invoices are born paid.
-- failed_at: first failed charge; the past-due clock (grace period) starts there.
create table if not exists billing.invoice (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
	amount bigint not null check (amount >= 0),
	currency text not null default 'ARS',
	status text not null default 'open' check (status in ('draft', 'open', 'paid', 'failed', 'void')),
	details jsonb not null default '{}',
	created_at timestamptz not null default now(),
	failed_at timestamptz,
	paid_at timestamptz,
	unique (organization_id, period)
);

-- The academy's Mercado Pago subscription to the platform (preapproval of the PLATFORM account).
-- lapsed_at: when it stopped being usable (cancelled); the past-due clock starts there.
create table if not exists billing.subscription (
	organization_id text primary key references auth.organization (id) on delete cascade,
	mp_preapproval_id text not null unique,
	status text not null check (status in ('pending', 'authorized', 'paused', 'cancelled')),
	payer_email text not null,
	lapsed_at timestamptz,
	-- Amount (minor units) the next charge takes, as last set at Mercado Pago; 0 while paused.
	charge_amount bigint,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- Each recurring charge Mercado Pago reported. applied_at makes a replayed notification pay invoices once.
create table if not exists billing.subscription_charge (
	mp_authorized_payment_id text primary key,
	organization_id text not null references auth.organization (id) on delete cascade,
	status text not null,
	amount bigint not null,
	applied_at timestamptz,
	updated_at timestamptz not null default now()
);

-- Our tables: certificates (frame per course and issued certificates; ADR-0025) -----------
create schema if not exists certificates;

-- One frame per course. image_path is relative to MEDIA_ROOT. `fields` holds, for
-- studentName / courseTitle / date / verificationCode: x and y (percent of the frame),
-- size (percent of the frame height), align and color.
create table if not exists certificates.template (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	course_id uuid not null unique references catalog.course (id) on delete cascade,
	image_path text not null,
	width integer not null,
	height integer not null,
	fields jsonb not null,
	created_at timestamptz not null default now()
);

-- One certificate per enrollment (idempotent issuing). credential_id is the public id.
create table if not exists certificates.certificate (
	id uuid primary key default gen_random_uuid(),
	credential_id text not null unique,
	organization_id text not null references auth.organization (id) on delete cascade,
	course_id uuid not null references catalog.course (id) on delete cascade,
	enrollment_id uuid not null unique references catalog.enrollment (id) on delete cascade,
	user_id text not null references auth."user" (id) on delete cascade,
	student_name text not null,
	course_title text not null,
	issued_at timestamptz not null default now(),
	status text not null default 'valid' check (status in ('valid', 'revoked')),
	revoked_at timestamptz,
	revoked_reason text,
	pdf_path text not null
);
create index if not exists certificate_course_idx on certificates.certificate (course_id, issued_at desc);
create index if not exists certificate_user_idx on certificates.certificate (user_id);

-- Our tables: automations (email messages sent on enrollment / course completion; ADR-0026) ---
create schema if not exists automations;

-- course_id null = every course of the academy. `body` and `subject` hold {{variables}}.
create table if not exists automations.automation (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	course_id uuid references catalog.course (id) on delete cascade,
	trigger text not null check (trigger in ('enrollment.created', 'course.completed')),
	name text not null,
	subject text not null,
	body text not null,
	-- course.completed only: attach the student's certificate PDF when it exists.
	attach_certificate boolean not null default false,
	enabled boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);
create index if not exists automation_org_idx on automations.automation (organization_id, trigger);

-- Files live under MEDIA_ROOT (path is relative) and are never served publicly.
create table if not exists automations.automation_attachment (
	id uuid primary key default gen_random_uuid(),
	automation_id uuid not null references automations.automation (id) on delete cascade,
	filename text not null,
	content_type text not null,
	bytes integer not null,
	path text not null
);
create index if not exists automation_attachment_idx on automations.automation_attachment (automation_id);

-- One row per (outbox event, automation): the unique key makes a replayed event send once.
-- last_error holds only a short code, never a provider response body.
create table if not exists automations.message_delivery (
	id uuid primary key default gen_random_uuid(),
	organization_id text not null references auth.organization (id) on delete cascade,
	automation_id uuid not null references automations.automation (id) on delete cascade,
	event_id text not null,
	course_id uuid not null,
	enrollment_id uuid,
	user_id text not null,
	email text not null,
	status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
	attempts integer not null default 0,
	next_attempt_at timestamptz not null default now(),
	last_error text,
	-- Message id returned by the provider (the Gmail API).
	provider_message_id text,
	sent_at timestamptz,
	created_at timestamptz not null default now(),
	unique (event_id, automation_id)
);
create index if not exists delivery_due_idx on automations.message_delivery (next_attempt_at) where status = 'pending';
create index if not exists delivery_org_idx on automations.message_delivery (organization_id, created_at desc);
create index if not exists delivery_recipient_idx on automations.message_delivery (organization_id, email, sent_at);

-- Unsubscribes are per academy (each academy is its own sender). Email is lower-cased.
create table if not exists automations.email_unsubscribe (
	organization_id text not null references auth.organization (id) on delete cascade,
	email text not null,
	created_at timestamptz not null default now(),
	primary key (organization_id, email)
);

-- Removed with Amazon SES (ADR-0028): per-academy sending state, bounce / complaint suppression and event column.
drop table if exists automations.sending;
drop table if exists automations.suppression;
alter table automations.message_delivery drop column if exists provider_event;

-- Gmail sending (ADR-0028). owner_key is an organization id, or the literal 'platform' for the
-- platform's own mailbox (verification, password reset); no foreign key because of that literal.
-- Tokens are encrypted with the secret box; both are null once disconnected.
create table if not exists automations.gmail_connection (
	owner_key text primary key,
	email text not null,
	access_token_encrypted text,
	refresh_token_encrypted text,
	expires_at timestamptz,
	status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
	-- Short reason, never token material or a provider response body.
	status_reason text,
	connected_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- Single-use state of an OAuth attempt in flight (the PKCE verifier is encrypted).
create table if not exists automations.gmail_oauth_state (
	state_hash text primary key,
	owner_key text not null,
	user_id text not null references auth."user" (id) on delete cascade,
	code_verifier_encrypted text not null,
	return_origin text not null,
	expires_at timestamptz not null
);

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
	body text not null check (length(body) between 1 and 4000),
	hidden boolean not null default false,
	created_at timestamptz not null default now()
);
create index if not exists comment_lesson_idx on community.comment (lesson_id, created_at);
create index if not exists comment_course_idx on community.comment (course_id, created_at);

-- Our tables: tenancy (DNS proof for custom domains) -----------------------------------
create schema if not exists tenancy;

create table if not exists tenancy.domain_check (
	organization_id text primary key references auth.organization (id) on delete cascade,
	token text not null,
	created_at timestamptz not null default now()
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

// Gmail sending (ADR-0028): every academy, and the platform itself, sends from a
// Gmail account it connected with OAuth (authorization code + PKCE). This file
// holds the OAuth attempt, the stored tokens, their renewal and the send call.
// owner_key is an organization id, or "platform" for the platform's mailbox.
// Nothing here logs tokens, codes, verifiers or Google's response bodies: only
// HTTP statuses, Google's error codes and ids.
import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { pool } from "../../server/db.server.ts";
import { log } from "../../server/log.server.ts";
import { appOrigin } from "../../server/origins.server.ts";
import {
	decryptSecret,
	encryptSecret,
} from "../../shared/crypto/secret-box.ts";
import { findRoles } from "../identity/members.ts";
import { resolveTenant } from "../tenancy/tenants.ts";

export const PLATFORM_OWNER = "platform";

// Only the send scope: no mailbox read access. `email` gives the sender address.
const SCOPES = "https://www.googleapis.com/auth/gmail.send openid email";
const STATE_MINUTES = 10;
/** A token that expires within this window is renewed before it is used. */
const USE_MARGIN_MS = 2 * 60 * 1000;
/** Above this size the message goes through the media upload endpoint. */
const JSON_LIMIT_BYTES = 3_000_000;
const RATE_REASONS = new Set([
	"rateLimitExceeded",
	"userRateLimitExceeded",
	"dailyLimitExceeded",
	"quotaExceeded",
	"RESOURCE_EXHAUSTED",
]);

// The three base URLs are Google's; they are overridable only to test against a local mock.
const authUrl = () =>
	process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const tokenUrl = () =>
	process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const revokeUrl = () => tokenUrl().replace(/\/token$/, "/revoke");
const apiUrl = () =>
	process.env.GOOGLE_API_URL || "https://gmail.googleapis.com";

/** The mailbox is not connected (never, disconnected by the owner, or revoked at Google). */
export class GmailNotConnected extends Error {
	constructor() {
		super("Gmail is not connected.");
		this.name = "GmailNotConnected";
	}
}

/** Quota, rate limit, network or Google 5xx: try again later, never disconnect. */
export class GmailRetry extends Error {
	retryInSeconds: number;
	constructor(reason: string, retryInSeconds: number) {
		super(`Gmail asked to retry later (${reason}).`);
		this.name = "GmailRetry";
		this.retryInSeconds = retryInSeconds;
	}
}

/** Google refused the request for a reason that retrying does not fix. */
export class GmailError extends Error {
	status: number;
	reason: string;
	constructor(status: number, reason: string) {
		super(`Gmail request failed (${status} ${reason}).`);
		this.name = "GmailError";
		this.status = status;
		this.reason = reason;
	}
}

function secretsKey(): string {
	const key = process.env.SECRETS_ENCRYPTION_KEY;
	if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required.");
	return key;
}

/** Fixed address Google sends the user back to (an authorized redirect URI of the OAuth client). */
export function callbackUrl(): string {
	return `${appOrigin()}/api/gmail/callback`;
}

export function gmailAvailable(): boolean {
	return Boolean(
		process.env.GOOGLE_CLIENT_ID &&
			process.env.GOOGLE_CLIENT_SECRET &&
			process.env.SECRETS_ENCRYPTION_KEY,
	);
}

// ------------------------------------------------------------- Google HTTP

type GoogleAnswer = { status: number; body: Record<string, unknown> };

/** One request to Google. Status 0 is a network failure. The body is parsed, never logged. */
async function google(url: string, init: RequestInit): Promise<GoogleAnswer> {
	try {
		const response = await fetch(url, {
			...init,
			signal: AbortSignal.timeout(20_000),
		});
		const body = await response.json().catch(() => ({}));
		return {
			status: response.status,
			body: typeof body === "object" && body !== null ? body : {},
		};
	} catch {
		return { status: 0, body: {} };
	}
}

function postForm(url: string, params: Record<string, string>) {
	return google(url, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params),
	});
}

/** Google's error code: OAuth `error`, or the first API error reason / status. */
function errorCode(answer: GoogleAnswer): string {
	const { error } = answer.body as {
		error?: string | { status?: string; errors?: { reason?: string }[] };
	};
	if (typeof error === "string") return error.slice(0, 60);
	return (error?.errors?.[0]?.reason ?? error?.status ?? "unknown").slice(
		0,
		60,
	);
}

// ------------------------------------------------------------ state and PKCE

/** The state is signed with a key derived from SECRETS_ENCRYPTION_KEY. */
function stateKey(): Buffer {
	return createHmac("sha256", secretsKey())
		.update("gmail-oauth-state")
		.digest();
}

/**
 * Short on purpose (45 characters): "<nonce>.<signature>". The signature covers
 * the nonce, the owner, the user and the expiry, which are stored in the
 * single-use row looked up by the nonce.
 */
function signState(
	nonce: string,
	ownerKey: string,
	userId: string,
	expiresAt: number,
): string {
	const signature = createHmac("sha256", stateKey())
		.update(`${nonce}|${ownerKey}|${userId}|${expiresAt}`)
		.digest("base64url")
		.slice(0, 22);
	return `${nonce}.${signature}`;
}

function stateNonce(state: string): string | null {
	const [nonce, signature, extra] = state.split(".");
	return nonce && signature && extra === undefined ? nonce : null;
}

function isSignedState(
	state: string,
	ownerKey: string,
	userId: string,
	expiresAt: number,
): boolean {
	const nonce = stateNonce(state);
	if (!nonce) return false;
	const received = Buffer.from(state);
	const wanted = Buffer.from(signState(nonce, ownerKey, userId, expiresAt));
	return received.length === wanted.length && timingSafeEqual(received, wanted);
}

const hashState = (state: string) =>
	createHash("sha256").update(state).digest("hex");

/** Where the user may be sent back to: the platform app, or the academy's own host. */
async function isReturnOrigin(
	ownerKey: string,
	origin: string,
): Promise<boolean> {
	if (ownerKey === PLATFORM_OWNER) return origin === appOrigin();
	try {
		const host = await resolveTenant(new URL(origin).host);
		return host.kind === "tenant" && host.tenant.id === ownerKey;
	} catch {
		return false;
	}
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
	const admin = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
	return Boolean(admin && email && email.trim().toLowerCase() === admin);
}

// ---------------------------------------------------------------- connecting

/** Creates the single-use OAuth attempt and returns the Google page to send the user to. */
export async function startConnection(input: {
	ownerKey: string;
	userId: string;
	returnOrigin: string;
}): Promise<string> {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	if (!clientId) throw new Error("GOOGLE_CLIENT_ID is required.");
	if (!(await isReturnOrigin(input.ownerKey, input.returnOrigin))) {
		throw new Error("The return address does not belong to this owner.");
	}

	const codeVerifier = randomBytes(64).toString("base64url");
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	const expiresAt = Date.now() + STATE_MINUTES * 60 * 1000;
	const state = signState(
		randomBytes(16).toString("base64url"),
		input.ownerKey,
		input.userId,
		expiresAt,
	);

	await pool.query(
		"delete from automations.gmail_oauth_state where expires_at < now()",
	);
	await pool.query(
		`insert into automations.gmail_oauth_state
		 (state_hash, owner_key, user_id, code_verifier_encrypted, return_origin, expires_at)
		 values ($1, $2, $3, $4, $5, $6)`,
		[
			hashState(state),
			input.ownerKey,
			input.userId,
			encryptSecret(codeVerifier, secretsKey()),
			input.returnOrigin,
			new Date(expiresAt),
		],
	);

	const url = new URL(authUrl());
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", callbackUrl());
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", SCOPES);
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	// offline + consent: Google returns a refresh token every time.
	url.searchParams.set("access_type", "offline");
	url.searchParams.set("prompt", "consent");
	return url.toString();
}

/** Why a connection failed; the panel shows a Spanish message for each code. */
export type ConnectionFailure =
	| "expired"
	| "session"
	| "role"
	| "denied"
	| "scope"
	| "exchange"
	| "save";

export type ConnectionResult =
	| { ok: true; ownerKey: string; returnOrigin: string }
	| {
			ok: false;
			reason: ConnectionFailure;
			ownerKey: string | null;
			returnOrigin: string | null;
	  };

/** Reads the `email` claim of an ID token received straight from Google's token endpoint over TLS. */
function idTokenEmail(idToken: unknown, clientId: string): string | null {
	if (typeof idToken !== "string") return null;
	try {
		const claims = JSON.parse(
			Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString(),
		) as { email?: unknown; email_verified?: unknown; aud?: unknown };
		if (claims.aud !== clientId) return null;
		if (claims.email_verified === false) return null;
		return typeof claims.email === "string" && claims.email.includes("@")
			? claims.email
			: null;
	} catch {
		return null;
	}
}

/**
 * Finishes the OAuth attempt: the state is consumed (single use), the person
 * must be the one who started it and still be allowed (academy owner/admin, or
 * the platform admin for the platform mailbox), and only then is the code
 * exchanged. `code` is null when the user denied access at Google.
 */
export async function completeConnection(input: {
	state: string;
	code: string | null;
	sessionUser: { id: string; email: string } | null;
}): Promise<ConnectionResult> {
	const expired: ConnectionResult = {
		ok: false,
		reason: "expired",
		ownerKey: null,
		returnOrigin: null,
	};
	if (!stateNonce(input.state)) return expired;

	// Deleting the row is what makes the state single use, even across servers.
	const { rows } = await pool.query<{
		owner_key: string;
		user_id: string;
		code_verifier_encrypted: string;
		return_origin: string;
		expires_at: Date;
	}>(
		`delete from automations.gmail_oauth_state where state_hash = $1
		 returning owner_key, user_id, code_verifier_encrypted, return_origin, expires_at`,
		[hashState(input.state)],
	);
	const stored = rows[0];
	if (
		!stored ||
		stored.expires_at.getTime() < Date.now() ||
		!isSignedState(
			input.state,
			stored.owner_key,
			stored.user_id,
			stored.expires_at.getTime(),
		)
	) {
		return expired;
	}
	const ownerKey = stored.owner_key;
	// The origin was validated when the attempt started; check again before using it.
	const returnOrigin = (await isReturnOrigin(ownerKey, stored.return_origin))
		? stored.return_origin
		: null;
	const fail = (reason: ConnectionFailure): ConnectionResult => ({
		ok: false,
		reason,
		ownerKey,
		returnOrigin,
	});

	const user = input.sessionUser;
	if (!user || user.id !== stored.user_id) return fail("session");
	if (ownerKey === PLATFORM_OWNER) {
		if (!isPlatformAdmin(user.email)) return fail("role");
	} else {
		const roles = await findRoles(ownerKey, user.id);
		if (!roles.includes("owner") && !roles.includes("admin")) {
			return fail("role");
		}
	}
	if (!input.code) return fail("denied");

	const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
	const answer = await postForm(tokenUrl(), {
		client_id: clientId,
		client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
		code: input.code,
		code_verifier: decryptSecret(stored.code_verifier_encrypted, secretsKey()),
		grant_type: "authorization_code",
		redirect_uri: callbackUrl(),
	});
	const { access_token, refresh_token, expires_in, scope, id_token } =
		answer.body as Record<string, unknown>;
	if (answer.status !== 200 || typeof access_token !== "string") {
		log.error(
			{ ownerKey, status: answer.status, code: errorCode(answer) },
			"Gmail code exchange failed",
		);
		return fail("exchange");
	}
	// The user can untick the send permission on Google's consent screen.
	if (
		typeof scope !== "string" ||
		!scope.split(" ").includes("https://www.googleapis.com/auth/gmail.send")
	) {
		return fail("scope");
	}
	const email = idTokenEmail(id_token, clientId);
	if (!email || typeof refresh_token !== "string") {
		log.error({ ownerKey }, "Gmail answer without email or refresh token");
		return fail("exchange");
	}

	try {
		await pool.query(
			`insert into automations.gmail_connection
			 (owner_key, email, access_token_encrypted, refresh_token_encrypted,
			  expires_at, status, status_reason, connected_at, updated_at)
			 values ($1, $2, $3, $4, $5, 'connected', null, now(), now())
			 on conflict (owner_key) do update set
			   email = excluded.email,
			   access_token_encrypted = excluded.access_token_encrypted,
			   refresh_token_encrypted = excluded.refresh_token_encrypted,
			   expires_at = excluded.expires_at,
			   status = 'connected', status_reason = null,
			   connected_at = now(), updated_at = now()`,
			[
				ownerKey,
				email,
				encryptSecret(access_token, secretsKey()),
				encryptSecret(refresh_token, secretsKey()),
				new Date(Date.now() + Number(expires_in || 3600) * 1000),
			],
		);
	} catch (error) {
		log.error(
			{ ownerKey, err: error instanceof Error ? error.name : "unknown" },
			"Saving the Gmail connection failed",
		);
		return fail("save");
	}
	return { ok: true, ownerKey, returnOrigin: stored.return_origin };
}

// ------------------------------------------------------------------- status

export type ConnectionStatus = "connected" | "disconnected" | "error";

export type GmailStatus = {
	status: ConnectionStatus | null;
	email: string | null;
};

/** What the panels show. Never token material. */
export async function gmailStatus(ownerKey: string): Promise<GmailStatus> {
	const { rows } = await pool.query<{
		status: ConnectionStatus;
		email: string;
	}>(
		"select status, email from automations.gmail_connection where owner_key = $1",
		[ownerKey],
	);
	return rows[0]
		? { status: rows[0].status, email: rows[0].email }
		: { status: null, email: null };
}

async function markDisconnected(ownerKey: string, reason: string) {
	await pool.query(
		`update automations.gmail_connection
		 set status = 'disconnected', status_reason = $2, access_token_encrypted = null,
		     refresh_token_encrypted = null, expires_at = null, updated_at = now()
		 where owner_key = $1`,
		[ownerKey, reason],
	);
	log.error({ ownerKey, reason }, "Gmail disconnected");
}

async function markError(ownerKey: string, reason: string) {
	await pool.query(
		`update automations.gmail_connection
		 set status = 'error', status_reason = $2, updated_at = now()
		 where owner_key = $1 and status <> 'disconnected'`,
		[ownerKey, reason],
	);
}

/** The owner disconnects: Google's revoke endpoint is called (best effort), then the tokens are deleted. */
export async function disconnect(ownerKey: string): Promise<void> {
	const { rows } = await pool.query<{
		refresh_token_encrypted: string | null;
		access_token_encrypted: string | null;
	}>(
		"select refresh_token_encrypted, access_token_encrypted from automations.gmail_connection where owner_key = $1",
		[ownerKey],
	);
	const box =
		rows[0]?.refresh_token_encrypted ?? rows[0]?.access_token_encrypted;
	if (box) {
		const answer = await postForm(revokeUrl(), {
			token: decryptSecret(box, secretsKey()),
		});
		if (answer.status !== 200) {
			log.warn({ ownerKey, status: answer.status }, "Gmail revoke failed");
		}
	}
	await markDisconnected(ownerKey, "Disconnected by the owner");
}

// ------------------------------------------------------------------- renewal

/**
 * Renews the access token under a row lock. With `staleToken`, a token that was
 * already replaced by someone else is returned without calling Google again.
 * `invalid_grant` (revoked, expired or unused refresh token) disconnects;
 * a network failure or a 5xx keeps the connection in `error` and throws GmailRetry.
 */
async function renew(ownerKey: string, staleToken?: string): Promise<string> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const { rows } = await client.query<{
			access_token_encrypted: string | null;
			refresh_token_encrypted: string | null;
		}>(
			`select access_token_encrypted, refresh_token_encrypted
			 from automations.gmail_connection
			 where owner_key = $1 and status <> 'disconnected' for update`,
			[ownerKey],
		);
		const row = rows[0];
		if (!row?.refresh_token_encrypted) {
			await client.query("commit");
			throw new GmailNotConnected();
		}
		if (staleToken && row.access_token_encrypted) {
			const current = decryptSecret(row.access_token_encrypted, secretsKey());
			if (current !== staleToken) {
				await client.query("commit");
				return current;
			}
		}

		const answer = await postForm(tokenUrl(), {
			client_id: process.env.GOOGLE_CLIENT_ID ?? "",
			client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
			grant_type: "refresh_token",
			refresh_token: decryptSecret(row.refresh_token_encrypted, secretsKey()),
		});
		const { access_token, expires_in, refresh_token } = answer.body as Record<
			string,
			unknown
		>;
		if (answer.status === 200 && typeof access_token === "string") {
			await client.query(
				`update automations.gmail_connection
				 set access_token_encrypted = $2, refresh_token_encrypted = $3, expires_at = $4,
				     status = 'connected', status_reason = null, updated_at = now()
				 where owner_key = $1`,
				[
					ownerKey,
					encryptSecret(access_token, secretsKey()),
					typeof refresh_token === "string"
						? encryptSecret(refresh_token, secretsKey())
						: row.refresh_token_encrypted,
					new Date(Date.now() + Number(expires_in || 3600) * 1000),
				],
			);
			await client.query("commit");
			return access_token;
		}

		const code = errorCode(answer);
		if (answer.status === 400 && code === "invalid_grant") {
			await client.query(
				`update automations.gmail_connection
				 set status = 'disconnected', status_reason = 'Google revoked or expired the access',
				     access_token_encrypted = null, refresh_token_encrypted = null,
				     expires_at = null, updated_at = now()
				 where owner_key = $1`,
				[ownerKey],
			);
			await client.query("commit");
			log.error({ ownerKey, status: 400, code }, "Gmail disconnected");
			throw new GmailNotConnected();
		}
		await client.query(
			`update automations.gmail_connection
			 set status = 'error', status_reason = $2, updated_at = now()
			 where owner_key = $1`,
			[ownerKey, `Token refresh failed (${answer.status} ${code})`],
		);
		await client.query("commit");
		log.error(
			{ ownerKey, status: answer.status, code },
			"Gmail refresh failed",
		);
		if (answer.status === 0 || answer.status >= 500 || answer.status === 429) {
			throw new GmailRetry(`token ${answer.status}`, 600);
		}
		throw new GmailError(answer.status, code);
	} catch (error) {
		await client.query("rollback").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}

/** An access token for the mailbox, renewed first when it expires within two minutes. */
async function accessToken(ownerKey: string): Promise<string> {
	const { rows } = await pool.query<{
		access_token_encrypted: string | null;
		expires_at: Date | null;
	}>(
		`select access_token_encrypted, expires_at from automations.gmail_connection
		 where owner_key = $1 and status <> 'disconnected'`,
		[ownerKey],
	);
	const row = rows[0];
	if (!row?.access_token_encrypted) throw new GmailNotConnected();
	const token = decryptSecret(row.access_token_encrypted, secretsKey());
	if (row.expires_at && row.expires_at.getTime() > Date.now() + USE_MARGIN_MS) {
		return token;
	}
	try {
		return await renew(ownerKey);
	} catch (error) {
		// A transient failure is fine while the current token still works.
		if (
			error instanceof GmailRetry &&
			row.expires_at &&
			row.expires_at.getTime() > Date.now()
		) {
			return token;
		}
		throw error;
	}
}

// ------------------------------------------------------------------- sending

async function postMessage(token: string, mime: Buffer) {
	const big = mime.length > JSON_LIMIT_BYTES;
	return google(
		big
			? `${apiUrl()}/upload/gmail/v1/users/me/messages/send?uploadType=media`
			: `${apiUrl()}/gmail/v1/users/me/messages/send`,
		{
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": big ? "message/rfc822" : "application/json",
			},
			body: big
				? new Uint8Array(mime)
				: JSON.stringify({ raw: mime.toString("base64url") }),
		},
	);
}

/**
 * Sends one message from the owner's Gmail. `build` receives the connected
 * address (the From) and returns the RFC 5322 message. Returns the Gmail
 * message id. Throws GmailNotConnected, GmailRetry (quota, rate, network, 5xx)
 * or GmailError. A 401 renews the token once and repeats the call once.
 */
export async function sendViaGmail(
	ownerKey: string,
	build: (senderEmail: string) => Buffer,
): Promise<string> {
	const { rows } = await pool.query<{ email: string }>(
		"select email from automations.gmail_connection where owner_key = $1 and status <> 'disconnected'",
		[ownerKey],
	);
	if (!rows[0]) throw new GmailNotConnected();
	const mime = build(rows[0].email);

	let token = await accessToken(ownerKey);
	let answer = await postMessage(token, mime);
	if (answer.status === 401) {
		token = await renew(ownerKey, token);
		answer = await postMessage(token, mime);
	}

	if (answer.status === 200 && typeof answer.body.id === "string") {
		await pool.query(
			`update automations.gmail_connection set status = 'connected', status_reason = null
			 where owner_key = $1 and status = 'error'`,
			[ownerKey],
		);
		return answer.body.id;
	}
	const code = errorCode(answer);
	log.warn({ ownerKey, status: answer.status, code }, "Gmail send failed");
	if (answer.status === 429 || RATE_REASONS.has(code)) {
		throw new GmailRetry(`${answer.status} ${code}`, 900);
	}
	if (answer.status === 0 || answer.status >= 500) {
		throw new GmailRetry(`${answer.status}`, 600);
	}
	if (answer.status === 401 || answer.status === 403) {
		// The permission is gone or the token keeps failing: the owner must reconnect.
		await markError(ownerKey, `Gmail answered ${answer.status} ${code}`);
	}
	throw new GmailError(answer.status, code);
}

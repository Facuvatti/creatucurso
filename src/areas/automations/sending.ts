// Per-academy SES sending (ADR-0027, docs/mails.md sections 1 and 4): one
// configuration set per academy with reputation metrics and an event destination
// to the shared SNS topic, and pause / resume of that set.
import { createHash } from "node:crypto";
import {
	CreateConfigurationSetCommand,
	CreateConfigurationSetEventDestinationCommand,
	PutConfigurationSetSendingOptionsCommand,
} from "@aws-sdk/client-sesv2";
import { pool } from "../../server/db.server.ts";
import {
	sendEmail,
	sesClient,
	sesConfigured,
} from "../../server/email.server.ts";
import { log, reportError } from "../../server/log.server.ts";

const SAFE_VALUE = /^[A-Za-z0-9_-]+$/;

/** SES names and tag values allow only ASCII letters, digits, "_" and "-". */
export function safeValue(value: string, maxLength: number): string {
	return SAFE_VALUE.test(value) && value.length <= maxLength
		? value
		: createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Deterministic configuration set name: tenant-<organizationId> (max 64 characters). */
export function configurationSetName(organizationId: string): string {
	return `tenant-${safeValue(organizationId, 57)}`;
}

/** Tags that correlate SES events with the academy and the course. */
export function emailTags(organizationId: string, courseId: string) {
	return {
		tenantId: safeValue(organizationId, 256),
		courseId: safeValue(courseId, 256),
	};
}

function isAlreadyExists(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "AlreadyExistsException" || error.name === "AlreadyExists")
	);
}

/**
 * Creates the academy's configuration set and event destination in SES, once.
 * Idempotent: AlreadyExists is fine, and the name is stored only when both calls
 * worked, so a failed run is simply repeated. Returns null when SES is not
 * configured (development). Throws on SES errors.
 */
export async function ensureTenantSending(
	organizationId: string,
): Promise<string | null> {
	if (!sesConfigured()) return null;
	const stored = await pool.query<{ configuration_set_name: string | null }>(
		"select configuration_set_name from automations.sending where organization_id = $1",
		[organizationId],
	);
	const existing = stored.rows[0]?.configuration_set_name;
	if (existing) return existing;

	const topicArn = process.env.SES_SNS_TOPIC_ARN;
	if (!topicArn) throw new Error("SES_SNS_TOPIC_ARN is required.");
	const name = configurationSetName(organizationId);
	const ses = sesClient();
	try {
		await ses.send(
			new CreateConfigurationSetCommand({
				ConfigurationSetName: name,
				ReputationOptions: { ReputationMetricsEnabled: true },
				SendingOptions: { SendingEnabled: true },
			}),
		);
	} catch (error) {
		if (!isAlreadyExists(error)) throw error;
	}
	try {
		await ses.send(
			new CreateConfigurationSetEventDestinationCommand({
				ConfigurationSetName: name,
				EventDestinationName: "sns-events",
				EventDestination: {
					Enabled: true,
					MatchingEventTypes: [
						"SEND",
						"DELIVERY",
						"BOUNCE",
						"COMPLAINT",
						"REJECT",
					],
					SnsDestination: { TopicArn: topicArn },
				},
			}),
		);
	} catch (error) {
		if (!isAlreadyExists(error)) throw error;
	}
	await pool.query(
		`insert into automations.sending (organization_id, configuration_set_name)
		 values ($1, $2)
		 on conflict (organization_id) do update set configuration_set_name = $2`,
		[organizationId, name],
	);
	return name;
}

/** Best effort (academy creation): never throws; logs the id and the error name only. */
export async function ensureTenantSendingQuietly(
	organizationId: string,
): Promise<void> {
	try {
		await ensureTenantSending(organizationId);
	} catch (error) {
		log.error(
			{
				organizationId,
				error: error instanceof Error ? error.name : "unknown",
			},
			"SES tenant provisioning failed",
		);
	}
}

async function setSendingEnabled(
	organizationId: string,
	enabled: boolean,
): Promise<void> {
	const name = await ensureTenantSending(organizationId);
	if (!name) return;
	await sesClient().send(
		new PutConfigurationSetSendingOptionsCommand({
			ConfigurationSetName: name,
			SendingEnabled: enabled,
		}),
	);
}

/** Disables the academy's set in SES (automatic pause); the database row is already paused. */
export async function pauseTenantSending(
	organizationId: string,
	reason: string,
): Promise<void> {
	try {
		await setSendingEnabled(organizationId, false);
	} catch (error) {
		reportError(`SES pause failed for ${organizationId}`, error);
	}
	reportError(
		"academy email sending paused",
		new Error(`${reason} for ${organizationId}`),
	);
	const admin = process.env.PLATFORM_ADMIN_EMAIL;
	if (!admin) return;
	await sendEmail({
		to: admin,
		subject: `Envío de emails pausado: ${organizationId}`,
		text: `Se pausó el envío de emails de la academia ${organizationId} (${reason}). Para reactivarlo: node scripts/resume-ses-tenant.ts ${organizationId}`,
		html: `<p>Se pausó el envío de emails de la academia <b>${organizationId}</b> (${reason}).</p><p>Para reactivarlo: <code>node scripts/resume-ses-tenant.ts ${organizationId}</code></p>`,
	}).catch((error) =>
		reportError("Notifying the platform admin failed", error),
	);
}

/** Admin only (a script today): enables the set in SES and marks the academy active. */
export async function resumeTenantSending(
	organizationId: string,
): Promise<void> {
	await setSendingEnabled(organizationId, true);
	await pool.query(
		`insert into automations.sending (organization_id, status)
		 values ($1, 'active')
		 on conflict (organization_id) do update
		   set status = 'active', paused_at = null, paused_reason = null`,
		[organizationId],
	);
}

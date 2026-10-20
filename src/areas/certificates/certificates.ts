// Certificates (ADR-0025): the frame of a course, issuing, the public page's
// data and revocation. The PDF is drawn here with pdf-lib.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { pool } from "../../server/db.server.ts";
import { log } from "../../server/log.server.ts";
import { prepareFrame } from "./frame.ts";
import {
	DEFAULT_FIELDS,
	FIELD_KEYS,
	type FieldKey,
	type IssuedCertificate,
	type PublicCertificate,
	SAMPLE_TEXT,
	type TemplateFields,
	type TemplateInfo,
} from "./types.ts";

function mediaRoot(): string {
	return path.resolve(process.env.MEDIA_ROOT ?? "./media-data");
}

/** Absolute path of a file stored under MEDIA_ROOT. */
function stored(relative: string): string {
	return path.join(mediaRoot(), relative);
}

// ------------------------------------------------------------------ template

/** Validates and stores the frame of a course (replaces the previous one). */
export async function saveFrame(
	organizationId: string,
	courseId: string,
	bytes: Buffer,
): Promise<{ ok: true } | { ok: false; message: string }> {
	const frame = await prepareFrame(bytes);
	if (!frame.ok) return frame;

	const { rows } = await pool.query<{ id: string }>(
		`insert into certificates.template (organization_id, course_id, image_path, width, height, fields)
		 values ($1, $2, '', $3, $4, $5)
		 on conflict (course_id) do update set width = excluded.width, height = excluded.height
		 returning id`,
		[organizationId, courseId, frame.width, frame.height, JSON.stringify(DEFAULT_FIELDS)],
	);
	const id = rows[0]?.id;
	if (!id) return { ok: false, message: "No se pudo guardar el diseño." };
	const relative = path.join("certificates", organizationId, `${id}.png`);
	await mkdir(path.dirname(stored(relative)), { recursive: true });
	await writeFile(stored(relative), frame.png);
	await pool.query(
		"update certificates.template set image_path = $2 where id = $1",
		[id, relative],
	);
	return { ok: true };
}

export async function saveFields(
	courseId: string,
	fields: TemplateFields,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		"update certificates.template set fields = $2 where course_id = $1",
		[courseId, JSON.stringify(fields)],
	);
	return (rowCount ?? 0) > 0;
}

export async function findTemplate(
	courseId: string,
): Promise<TemplateInfo | null> {
	const { rows } = await pool.query<{
		width: number;
		height: number;
		fields: TemplateFields;
	}>(
		"select width, height, fields from certificates.template where course_id = $1",
		[courseId],
	);
	return rows[0] ?? null;
}

/** The stored frame PNG of a course, for the creator's preview. */
export async function readFrame(courseId: string): Promise<Buffer | null> {
	const { rows } = await pool.query<{ image_path: string }>(
		"select image_path from certificates.template where course_id = $1",
		[courseId],
	);
	if (!rows[0]?.image_path) return null;
	return readFile(stored(rows[0].image_path)).catch(() => null);
}

// ----------------------------------------------------------------------- pdf

/** Keeps only characters that Helvetica (WinAnsi) can draw; accents fall back to the base letter. */
function winAnsi(text: string, allowed: Set<number>): string {
	let result = "";
	for (const char of text.normalize("NFC")) {
		const code = char.codePointAt(0) ?? 0;
		if (code >= 32 && allowed.has(code)) {
			result += char;
			continue;
		}
		const base = char.normalize("NFD")[0];
		const baseCode = base?.codePointAt(0) ?? 0;
		if (base && baseCode >= 32 && allowed.has(baseCode)) result += base;
	}
	return result.replace(/\s+/g, " ").trim();
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("es-AR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "America/Argentina/Buenos_Aires",
	});
}

async function renderPdf(
	frame: Buffer,
	template: TemplateInfo,
	texts: Record<FieldKey, string>,
): Promise<Buffer> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const allowed = new Set(font.getCharacterSet());
	const { width, height } = template;
	const page = doc.addPage([width, height]);
	page.drawImage(await doc.embedPng(frame), { x: 0, y: 0, width, height });

	for (const key of FIELD_KEYS) {
		const field = template.fields[key];
		const text = winAnsi(texts[key], allowed);
		if (!text) continue;
		const size = (field.size / 100) * height;
		const textWidth = font.widthOfTextAtSize(text, size);
		const anchor = (field.x / 100) * width;
		const x =
			field.align === "center"
				? anchor - textWidth / 2
				: field.align === "right"
					? anchor - textWidth
					: anchor;
		// y is the vertical center of the line; the baseline sits ~0.35 em below it.
		const y = height - (field.y / 100) * height - size * 0.35;
		const hex = field.color.slice(1);
		page.drawText(text, {
			x,
			y,
			size,
			font,
			color: rgb(
				Number.parseInt(hex.slice(0, 2), 16) / 255,
				Number.parseInt(hex.slice(2, 4), 16) / 255,
				Number.parseInt(hex.slice(4, 6), 16) / 255,
			),
		});
	}
	return Buffer.from(await doc.save());
}

/** A sample certificate for the creator to check the placement. */
export async function previewPdf(courseId: string): Promise<Buffer | null> {
	const [frame, template] = await Promise.all([
		readFrame(courseId),
		findTemplate(courseId),
	]);
	if (!frame || !template) return null;
	return renderPdf(frame, template, SAMPLE_TEXT);
}

// ------------------------------------------------------------------- issuing

/**
 * Issues the certificate of a completed enrollment. Safe to repeat: one per
 * enrollment. Does nothing when the enrollment is not active or the course has
 * no frame yet. Returns the credential id when one was created.
 */
export async function issueCertificate(
	enrollmentId: string,
): Promise<string | null> {
	const { rows } = await pool.query<{
		organization_id: string;
		course_id: string;
		user_id: string;
		student_name: string;
		course_title: string;
		status: string;
		has_certificate: boolean;
	}>(
		`select c.organization_id, e.course_id, e.user_id, u.name as student_name,
		        c.name as course_title, e.status::text as status,
		        exists (select 1 from certificates.certificate x where x.enrollment_id = e.id) as has_certificate
		 from catalog.enrollment e
		 join catalog.course c on c.id = e.course_id
		 join auth."user" u on u.id = e.user_id
		 where e.id = $1`,
		[enrollmentId],
	);
	const row = rows[0];
	if (!row || row.has_certificate) return null;
	if (row.status !== "active") {
		log.info({ enrollmentId }, "certificate skipped: enrollment not active");
		return null;
	}
	const [frame, template] = await Promise.all([
		readFrame(row.course_id),
		findTemplate(row.course_id),
	]);
	if (!frame || !template) {
		log.info({ enrollmentId }, "certificate skipped: course has no frame");
		return null;
	}

	const credentialId = randomBytes(12).toString("base64url");
	const issuedAt = new Date();
	const pdf = await renderPdf(frame, template, {
		studentName: row.student_name,
		courseTitle: row.course_title,
		date: formatDate(issuedAt),
		verificationCode: `Código: ${credentialId}`,
	});
	const relative = path.join(
		"certificates",
		row.organization_id,
		`${credentialId}.pdf`,
	);
	await mkdir(path.dirname(stored(relative)), { recursive: true });
	await writeFile(stored(relative), pdf);

	const inserted = await pool.query(
		`insert into certificates.certificate
		   (credential_id, organization_id, course_id, enrollment_id, user_id,
		    student_name, course_title, issued_at, pdf_path)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 on conflict (enrollment_id) do nothing returning id`,
		[
			credentialId,
			row.organization_id,
			row.course_id,
			enrollmentId,
			row.user_id,
			row.student_name,
			row.course_title,
			issuedAt,
			relative,
		],
	);
	if (!inserted.rows[0]) {
		await rm(stored(relative), { force: true });
		return null;
	}
	log.info({ enrollmentId, credentialId }, "certificate issued");
	return credentialId;
}

/** Issues the certificates of already-completed active enrollments that have none. */
export async function issuePendingCertificates(
	courseId: string,
): Promise<number> {
	const { rows } = await pool.query<{ id: string }>(
		`select e.id from catalog.enrollment e
		 where e.course_id = $1 and e.status = 'active' and e.completed_at is not null
		   and not exists (select 1 from certificates.certificate x where x.enrollment_id = e.id)`,
		[courseId],
	);
	let issued = 0;
	for (const row of rows) {
		if (await issueCertificate(row.id)) issued += 1;
	}
	return issued;
}

/** Number of completed active enrollments still without a certificate. */
export async function countPending(courseId: string): Promise<number> {
	const { rows } = await pool.query<{ n: string }>(
		`select count(*) as n from catalog.enrollment e
		 where e.course_id = $1 and e.status = 'active' and e.completed_at is not null
		   and not exists (select 1 from certificates.certificate x where x.enrollment_id = e.id)`,
		[courseId],
	);
	return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------- reads/revoke

export async function listCourseCertificates(
	courseId: string,
): Promise<IssuedCertificate[]> {
	const { rows } = await pool.query<{
		id: string;
		credential_id: string;
		student_name: string;
		issued_at: Date;
		status: "valid" | "revoked";
		revoked_reason: string | null;
	}>(
		`select id, credential_id, student_name, issued_at, status, revoked_reason
		 from certificates.certificate where course_id = $1
		 order by issued_at desc limit 200`,
		[courseId],
	);
	return rows.map((r) => ({
		id: r.id,
		credentialId: r.credential_id,
		studentName: r.student_name,
		issuedAt: r.issued_at.toISOString(),
		status: r.status,
		revokedReason: r.revoked_reason,
	}));
}

/** Revokes a certificate of the academy. Returns false when it is not found or already revoked. */
export async function revokeCertificate(
	organizationId: string,
	certificateId: string,
	reason: string,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update certificates.certificate
		 set status = 'revoked', revoked_at = now(), revoked_reason = $3
		 where id = $1 and organization_id = $2 and status = 'valid'`,
		[certificateId, organizationId, reason || null],
	);
	return (rowCount ?? 0) > 0;
}

/** Revokes the certificate of an enrollment inside the caller's transaction (refund, lost dispute). */
export async function revokeForEnrollment(
	client: PoolClient,
	courseId: string,
	userId: string,
	reason: string,
): Promise<void> {
	await client.query(
		`update certificates.certificate
		 set status = 'revoked', revoked_at = now(), revoked_reason = $3
		 where course_id = $1 and user_id = $2 and status = 'valid'`,
		[courseId, userId, reason],
	);
}

/** The certificate of a student for a course (any status), or null. */
export async function findMyCertificate(
	courseId: string,
	userId: string,
): Promise<{ credentialId: string; status: "valid" | "revoked" } | null> {
	const { rows } = await pool.query<{
		credential_id: string;
		status: "valid" | "revoked";
	}>(
		"select credential_id, status from certificates.certificate where course_id = $1 and user_id = $2",
		[courseId, userId],
	);
	return rows[0]
		? { credentialId: rows[0].credential_id, status: rows[0].status }
		: null;
}

/** Minimal public data of a certificate of this academy. No email. */
export async function findPublicCertificate(
	organizationId: string,
	credentialId: string,
): Promise<PublicCertificate | null> {
	const { rows } = await pool.query<{
		credential_id: string;
		student_name: string;
		course_title: string;
		issuer: string;
		issued_at: Date;
		status: "valid" | "revoked";
	}>(
		`select c.credential_id, c.student_name, c.course_title, o.name as issuer, c.issued_at, c.status
		 from certificates.certificate c
		 join auth.organization o on o.id = c.organization_id
		 where c.credential_id = $1 and c.organization_id = $2`,
		[credentialId, organizationId],
	);
	const r = rows[0];
	return r
		? {
				credentialId: r.credential_id,
				studentName: r.student_name,
				courseTitle: r.course_title,
				issuerName: r.issuer,
				issuedAt: r.issued_at.toISOString(),
				status: r.status,
			}
		: null;
}

/** The PDF of a VALID certificate of this academy. */
export async function readCertificatePdf(
	organizationId: string,
	credentialId: string,
): Promise<{ pdf: Buffer; fileName: string } | null> {
	const { rows } = await pool.query<{ pdf_path: string; course_title: string }>(
		`select pdf_path, course_title from certificates.certificate
		 where credential_id = $1 and organization_id = $2 and status = 'valid'`,
		[credentialId, organizationId],
	);
	if (!rows[0]) return null;
	const pdf = await readFile(stored(rows[0].pdf_path)).catch(() => null);
	return pdf ? { pdf, fileName: `certificado-${credentialId}.pdf` } : null;
}

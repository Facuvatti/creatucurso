import { createServerFn } from "@tanstack/react-start";
import * as catalog from "../areas/catalog/catalog.ts";
import * as certificates from "../areas/certificates/certificates.ts";
import {
	checkFields,
	type IssuedCertificate,
	type PublicCertificate,
	type TemplateInfo,
} from "../areas/certificates/types.ts";
import { record, text, uuid } from "../shared/validate.ts";
import { requireStaffContext, requireTenantContext } from "./request.server.ts";

type Result = { ok: true } | { ok: false; message: string };

export type CertificatePanel = {
	template: TemplateInfo | null;
	issued: IssuedCertificate[];
	pending: number;
};

/** The staff member's course of this academy, or null. */
async function staffCourse(courseId: string) {
	const { tenant } = await requireStaffContext();
	const course = await catalog.findCourseById(tenant.id, courseId);
	return course ? { tenant, course } : null;
}

export const getCertificatePanel = createServerFn({ method: "GET" })
	.validator((data: unknown) => ({ courseId: uuid(record(data), "courseId") }))
	.handler(async ({ data }): Promise<CertificatePanel> => {
		const found = await staffCourse(data.courseId);
		if (!found) return { template: null, issued: [], pending: 0 };
		const [template, issued, pending] = await Promise.all([
			certificates.findTemplate(data.courseId),
			certificates.listCourseCertificates(data.courseId),
			certificates.countPending(data.courseId),
		]);
		return { template, issued, pending };
	});

export const saveCertificateFields = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			courseId: uuid(input, "courseId"),
			fields: checkFields(input.fields),
		};
	})
	.handler(async ({ data }): Promise<Result> => {
		if (!(await staffCourse(data.courseId))) {
			return { ok: false, message: "No encontramos el curso." };
		}
		const saved = await certificates.saveFields(data.courseId, data.fields);
		return saved
			? { ok: true }
			: { ok: false, message: "Primero subí el diseño del certificado." };
	});

export const issuePendingCertificates = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({ courseId: uuid(record(data), "courseId") }))
	.handler(async ({ data }): Promise<Result & { issued?: number }> => {
		if (!(await staffCourse(data.courseId))) {
			return { ok: false, message: "No encontramos el curso." };
		}
		if (!(await certificates.findTemplate(data.courseId))) {
			return { ok: false, message: "Primero subí el diseño del certificado." };
		}
		return {
			ok: true,
			issued: await certificates.issuePendingCertificates(data.courseId),
		};
	});

export const revokeCertificate = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			certificateId: uuid(input, "certificateId"),
			reason: text(input, "reason", 300),
		};
	})
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		const revoked = await certificates.revokeCertificate(
			tenant.id,
			data.certificateId,
			data.reason,
		);
		return revoked
			? { ok: true }
			: { ok: false, message: "No se pudo revocar el certificado." };
	});

/** The signed-in student's certificate for a course, if any. */
export const getMyCertificate = createServerFn({ method: "GET" })
	.validator((data: unknown) => ({
		courseSlug: text(record(data), "courseSlug", 200, 1),
	}))
	.handler(
		async ({
			data,
		}): Promise<{
			credentialId: string;
			status: "valid" | "revoked";
		} | null> => {
			const { tenant, user } = await requireTenantContext();
			if (!user) return null;
			const lookup = await catalog.findCourseBySlug(tenant.id, data.courseSlug);
			if (!lookup || lookup.kind !== "found") return null;
			return certificates.findMyCertificate(lookup.course.id, user.id);
		},
	);

/** Public: minimal data of a certificate issued by this academy. */
export const getPublicCertificate = createServerFn({ method: "GET" })
	.validator((data: unknown) => ({
		credentialId: text(record(data), "credentialId", 64, 1),
	}))
	.handler(async ({ data }): Promise<PublicCertificate | null> => {
		const { tenant } = await requireTenantContext();
		return certificates.findPublicCertificate(tenant.id, data.credentialId);
	});

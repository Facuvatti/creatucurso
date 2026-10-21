import { createServerFn } from "@tanstack/react-start";
import * as automations from "../areas/automations/automations.ts";
import { sendTestEmail } from "../areas/automations/delivery.ts";
import {
	type GmailStatus,
	gmailAvailable,
	gmailStatus,
} from "../areas/automations/gmail.ts";
import {
	SAMPLE_VARIABLES,
	TRIGGERS,
	type Trigger,
} from "../areas/automations/template.ts";
import * as catalog from "../areas/catalog/catalog.ts";
import { bool, oneOf, record, text, uuid } from "../shared/validate.ts";
import { requireStaffContext } from "./request.server.ts";

type Result = { ok: true } | { ok: false; message: string };

export type AutomationsPanel = {
	automations: automations.Automation[];
	courses: { id: string; name: string }[];
	deliveries: automations.DeliveryRow[];
	gmail: GmailStatus & { available: boolean; canManage: boolean };
};

export const getAutomationsPanel = createServerFn({ method: "GET" }).handler(
	async (): Promise<AutomationsPanel> => {
		const { tenant, roles } = await requireStaffContext();
		const [list, courses, deliveries, gmail] = await Promise.all([
			automations.listAutomations(tenant.id),
			catalog.listCourses(tenant.id, { publishedOnly: false }),
			automations.listDeliveries(tenant.id),
			gmailStatus(tenant.id),
		]);
		return {
			automations: list,
			courses: courses.map((c) => ({ id: c.id, name: c.name })),
			deliveries,
			gmail: {
				...gmail,
				available: gmailAvailable(),
				canManage: roles.includes("owner") || roles.includes("admin"),
			},
		};
	},
);

function checkInput(data: unknown) {
	const input = record(data);
	const courseId = input.courseId;
	return {
		id: input.id ? uuid(input, "id") : null,
		courseId: courseId ? uuid(input, "courseId") : null,
		trigger: oneOf<Trigger>(input, "trigger", TRIGGERS),
		name: text(input, "name", 120, 1),
		subject: text(input, "subject", 200, 1),
		body: text(input, "body", 10000, 1),
		attachCertificate: bool(input, "attachCertificate"),
	};
}

export const saveAutomation = createServerFn({ method: "POST" })
	.validator(checkInput)
	.handler(async ({ data }): Promise<Result & { id?: string }> => {
		const { tenant } = await requireStaffContext();
		const { id, ...input } = data;
		return automations.saveAutomation(tenant.id, id, input);
	});

export const setAutomationEnabled = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return { id: uuid(input, "id"), enabled: bool(input, "enabled") };
	})
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		return (await automations.setAutomationEnabled(
			tenant.id,
			data.id,
			data.enabled,
		))
			? { ok: true }
			: { ok: false, message: "No encontramos la automatización." };
	});

export const deleteAutomation = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({ id: uuid(record(data), "id") }))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		return (await automations.deleteAutomation(tenant.id, data.id))
			? { ok: true }
			: { ok: false, message: "No encontramos la automatización." };
	});

export const removeAttachment = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({ id: uuid(record(data), "id") }))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		return (await automations.removeAttachment(tenant.id, data.id))
			? { ok: true }
			: { ok: false, message: "No encontramos el archivo." };
	});

/** Sends the message, with sample data, to the signed-in creator only. */
export const sendTestAutomation = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			automationId: input.automationId ? uuid(input, "automationId") : null,
			subject: text(input, "subject", 200, 1),
			body: text(input, "body", 10000, 1),
		};
	})
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, user } = await requireStaffContext();
		return sendTestEmail({
			organizationId: tenant.id,
			automationId: data.automationId,
			to: user.email,
			subject: data.subject,
			body: data.body,
			values: { ...SAMPLE_VARIABLES, academyName: tenant.name },
		});
	});

import { createFileRoute } from "@tanstack/react-router";
import {
	addAttachment,
	MAX_FILE_BYTES,
} from "../../../areas/automations/automations.ts";
import { can } from "../../../areas/identity/permissions.ts";
import { readRequestContext } from "../../../server/request.server.ts";

// POST /api/automations/attachments/<automationId>  -> raw file bytes
// (application/octet-stream), file name in the x-filename header (URL-encoded).
export const Route = createFileRoute(
	"/api/automations/attachments/$automationId",
)({
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				if (
					request.headers.get("content-type") !== "application/octet-stream"
				) {
					return Response.json({ error: "bad-request" }, { status: 400 });
				}
				const declared = Number(request.headers.get("content-length") ?? 0);
				if (declared > MAX_FILE_BYTES) {
					return Response.json(
						{ ok: false, message: "Cada archivo puede pesar hasta 10 MB." },
						{ status: 413 },
					);
				}
				const context = await readRequestContext();
				if (context.host.kind !== "tenant") {
					return Response.json({ error: "not-found" }, { status: 404 });
				}
				if (!context.user || !can(context.roles, { course: ["update"] })) {
					return Response.json({ error: "denied" }, { status: 403 });
				}
				let filename = "";
				try {
					filename = decodeURIComponent(
						request.headers.get("x-filename") ?? "",
					);
				} catch {
					return Response.json({ error: "bad-request" }, { status: 400 });
				}
				const bytes = Buffer.from(await request.arrayBuffer());
				const result = await addAttachment(
					context.host.tenant.id,
					params.automationId,
					filename,
					bytes,
				);
				return Response.json(result, { status: result.ok ? 200 : 422 });
			},
		},
	},
});

import { createFileRoute } from "@tanstack/react-router";
import * as catalog from "../../../areas/catalog/catalog.ts";
import {
	readFrame,
	saveFrame,
} from "../../../areas/certificates/certificates.ts";
import { FRAME_MAX_BYTES } from "../../../areas/certificates/frame.ts";
import { can } from "../../../areas/identity/permissions.ts";
import { readRequestContext } from "../../../server/request.server.ts";

/** The staff member's course of this academy, or a ready error response. */
async function staffCourse(courseId: string) {
	const context = await readRequestContext();
	if (context.host.kind !== "tenant") {
		return { error: Response.json({ error: "not-found" }, { status: 404 }) };
	}
	if (!context.user || !can(context.roles, { course: ["update"] })) {
		return { error: Response.json({ error: "denied" }, { status: 403 }) };
	}
	const course = await catalog.findCourseById(context.host.tenant.id, courseId);
	if (!course) {
		return { error: Response.json({ error: "not-found" }, { status: 404 }) };
	}
	return { tenantId: context.host.tenant.id, courseId: course.id };
}

// GET  /api/certificates/frame/<courseId>  -> the stored frame (PNG), creator only.
// POST /api/certificates/frame/<courseId>  -> raw file bytes (application/octet-stream).
export const Route = createFileRoute("/api/certificates/frame/$courseId")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const found = await staffCourse(params.courseId);
				if ("error" in found) return found.error;
				const png = await readFrame(found.courseId);
				if (!png) return new Response("Not found", { status: 404 });
				return new Response(new Uint8Array(png), {
					headers: {
						"Content-Type": "image/png",
						"Cache-Control": "private, no-store",
						"X-Content-Type-Options": "nosniff",
					},
				});
			},
			POST: async ({ request, params }) => {
				// A custom content type cannot be sent by a cross-site form.
				if (
					request.headers.get("content-type") !== "application/octet-stream"
				) {
					return Response.json({ error: "bad-request" }, { status: 400 });
				}
				const declared = Number(request.headers.get("content-length") ?? 0);
				if (declared > FRAME_MAX_BYTES) {
					return Response.json(
						{ ok: false, message: "El archivo pesa más de 8 MB." },
						{ status: 413 },
					);
				}
				const found = await staffCourse(params.courseId);
				if ("error" in found) return found.error;
				const bytes = Buffer.from(await request.arrayBuffer());
				const result = await saveFrame(found.tenantId, found.courseId, bytes);
				return Response.json(result, { status: result.ok ? 200 : 422 });
			},
		},
	},
});

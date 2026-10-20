import { createFileRoute } from "@tanstack/react-router";
import * as catalog from "../../../areas/catalog/catalog.ts";
import { previewPdf } from "../../../areas/certificates/certificates.ts";
import { can } from "../../../areas/identity/permissions.ts";
import { readRequestContext } from "../../../server/request.server.ts";

// GET /api/certificates/preview/<courseId> -> a sample certificate PDF, creator only.
export const Route = createFileRoute("/api/certificates/preview/$courseId")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const context = await readRequestContext();
				if (context.host.kind !== "tenant") {
					return new Response("Not found", { status: 404 });
				}
				if (!context.user || !can(context.roles, { course: ["update"] })) {
					return new Response("Forbidden", { status: 403 });
				}
				const course = await catalog.findCourseById(
					context.host.tenant.id,
					params.courseId,
				);
				const pdf = course ? await previewPdf(course.id) : null;
				if (!pdf) return new Response("Not found", { status: 404 });
				return new Response(new Uint8Array(pdf), {
					headers: {
						"Content-Type": "application/pdf",
						"Content-Disposition": 'inline; filename="vista-previa.pdf"',
						"Cache-Control": "private, no-store",
					},
				});
			},
		},
	},
});

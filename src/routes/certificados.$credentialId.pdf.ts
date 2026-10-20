import { createFileRoute } from "@tanstack/react-router";
import { readCertificatePdf } from "../areas/certificates/certificates.ts";
import { readRequestContext } from "../server/request.server.ts";

// GET /certificados/<credentialId>/pdf -> the PDF of a valid certificate.
export const Route = createFileRoute("/certificados/$credentialId/pdf")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const context = await readRequestContext();
				if (context.host.kind !== "tenant") {
					return new Response("Not found", { status: 404 });
				}
				const found = await readCertificatePdf(
					context.host.tenant.id,
					params.credentialId,
				);
				if (!found) return new Response("Not found", { status: 404 });
				return new Response(new Uint8Array(found.pdf), {
					headers: {
						"Content-Type": "application/pdf",
						"Content-Disposition": `attachment; filename="${found.fileName}"`,
						"X-Content-Type-Options": "nosniff",
					},
				});
			},
		},
	},
});

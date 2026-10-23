import { createFileRoute } from "@tanstack/react-router";
import { readAttachment } from "../../../areas/chat/chat.ts";
import { can } from "../../../areas/identity/permissions.ts";
import { readRequestContext } from "../../../server/request.server.ts";
import { uuid } from "../../../shared/validate.ts";

// GET /api/chat/attachment/<messageId>
// The only way out for a chat file: only the two people of the conversation get
// it. Images show inline; a PDF is always a download. The stored type is
// fixed by the server, never by the uploader.
export const Route = createFileRoute("/api/chat/attachment/$messageId")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const context = await readRequestContext();
				if (context.host.kind !== "tenant") {
					return new Response("Not found", { status: 404 });
				}
				const { user } = context;
				if (!user || !can(context.roles, { chat: ["participate"] })) {
					return new Response("Login required", { status: 401 });
				}
				let messageId: string;
				try {
					messageId = uuid({ id: params.messageId }, "id");
				} catch {
					return new Response("Not found", { status: 404 });
				}
				const file = await readAttachment(
					context.host.tenant.id,
					user.id,
					messageId,
				);
				if (!file) return new Response("Not found", { status: 404 });

				const inline = file.type.startsWith("image/");
				return new Response(new Uint8Array(file.bytes), {
					headers: {
						"Content-Type": file.type,
						"Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
						"Cache-Control": "private, no-store",
						"X-Content-Type-Options": "nosniff",
						"Content-Security-Policy": "default-src 'none'; sandbox",
					},
				});
			},
		},
	},
});

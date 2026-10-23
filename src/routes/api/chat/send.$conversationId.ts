import { createFileRoute } from "@tanstack/react-router";
import {
	attachmentMaxBytes,
	MESSAGE_MAX_LENGTH,
	sendMessage,
} from "../../../areas/chat/chat.ts";
import { can } from "../../../areas/identity/permissions.ts";
import { readRequestContext } from "../../../server/request.server.ts";
import { uuid } from "../../../shared/validate.ts";

// POST /api/chat/send/<conversationId>   multipart/form-data: body (text), file (optional)
// Used for messages that carry a file; text-only messages use the server function.
// The custom header cannot be sent by a cross-site form.
export const Route = createFileRoute("/api/chat/send/$conversationId")({
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				if (request.headers.get("x-chat-upload") !== "1") {
					return Response.json(
						{ ok: false, message: "Solicitud inválida." },
						{ status: 400 },
					);
				}
				const declared = Number(request.headers.get("content-length") ?? 0);
				// Some room for the multipart envelope and the text.
				if (declared > attachmentMaxBytes() + 64 * 1024) {
					return Response.json(
						{ ok: false, message: "El archivo es demasiado pesado." },
						{ status: 413 },
					);
				}
				const context = await readRequestContext();
				if (context.host.kind !== "tenant") {
					return Response.json(
						{ ok: false, message: "No encontrado." },
						{ status: 404 },
					);
				}
				const { user } = context;
				if (!user || !can(context.roles, { chat: ["participate"] })) {
					return Response.json(
						{ ok: false, message: "Iniciá sesión." },
						{ status: 401 },
					);
				}

				let conversationId: string;
				let body: string;
				let file: { bytes: Buffer; name: string } | undefined;
				try {
					conversationId = uuid({ id: params.conversationId }, "id");
					const form = await request.formData();
					const rawBody = form.get("body");
					body = typeof rawBody === "string" ? rawBody : "";
					if (body.length > MESSAGE_MAX_LENGTH * 2) throw new Error("body");
					const upload = form.get("file");
					if (upload instanceof File && upload.size > 0) {
						file = {
							bytes: Buffer.from(await upload.arrayBuffer()),
							name: upload.name,
						};
					}
				} catch {
					return Response.json(
						{ ok: false, message: "Solicitud inválida." },
						{ status: 400 },
					);
				}

				const result = await sendMessage(
					context.host.tenant.id,
					user.id,
					conversationId,
					file ? { body, file } : { body },
				);
				return Response.json(result, { status: result.ok ? 200 : 422 });
			},
		},
	},
});

import { createFileRoute } from "@tanstack/react-router";
import { subscribe } from "../../../areas/chat/chat.ts";
import { can } from "../../../areas/identity/permissions.ts";
import { readRequestContext } from "../../../server/request.server.ts";

const HEARTBEAT_MS = 25_000;

// GET /api/chat/stream
// Server-sent events for the signed-in person of this academy (by request Host).
// Each message sent in one of their conversations arrives as an `event: message`
// with a ChatEvent as JSON. In-process only (ADR-0032). Caddy needs
// `flush_interval -1` for this path.
export const Route = createFileRoute("/api/chat/stream")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const context = await readRequestContext();
				if (context.host.kind !== "tenant") {
					return Response.json({ error: "not-found" }, { status: 404 });
				}
				const { user } = context;
				if (!user || !can(context.roles, { chat: ["participate"] })) {
					return Response.json({ error: "login" }, { status: 401 });
				}
				const organizationId = context.host.tenant.id;

				const encoder = new TextEncoder();
				let cleanup = () => {};
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						const write = (chunk: string) => {
							try {
								controller.enqueue(encoder.encode(chunk));
							} catch {
								cleanup();
							}
						};
						const unsubscribe = subscribe(user.id, (event) => {
							// A person can belong to several academies: this stream is one host.
							if (event.organizationId !== organizationId) return;
							write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
						});
						const heartbeat = setInterval(
							() => write(": ping\n\n"),
							HEARTBEAT_MS,
						);
						cleanup = () => {
							clearInterval(heartbeat);
							unsubscribe();
							request.signal.removeEventListener("abort", cleanup);
							try {
								controller.close();
							} catch {
								// Already closed by the client.
							}
						};
						request.signal.addEventListener("abort", cleanup);
						// Tell the browser how long to wait before it reconnects by itself.
						write("retry: 3000\n: connected\n\n");
					},
					cancel() {
						cleanup();
					},
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
						// Tells nginx-like proxies not to buffer this response.
						"X-Accel-Buffering": "no",
					},
				});
			},
		},
	},
});

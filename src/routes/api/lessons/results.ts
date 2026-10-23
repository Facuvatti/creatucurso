import { createFileRoute } from "@tanstack/react-router";
import {
	findSession,
	getAppSecret,
	MAX_REPORT_BYTES,
	normalizeResult,
	passingScoreOf,
	recordResult,
	verifyServerSignature,
} from "../../../areas/catalog/embed.ts";

// POST /api/lessons/results
// Headers: X-Timestamp (Unix seconds), X-Signature (hex HMAC-SHA256 of
// `${timestamp}.${rawBody}` with the course secret).
// Body: { session, score?, maxScore?, passed?, timeSpentSec?, metadata? }
// Called by the backend of an embedded app (not by a browser), so it does not
// depend on the host. The result is stored as verified.
const json = (body: Record<string, unknown>, status: number) =>
	Response.json(body, { status });

export const Route = createFileRoute("/api/lessons/results")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const declared = Number(request.headers.get("content-length") ?? 0);
				if (declared > MAX_REPORT_BYTES) {
					return json({ error: "too-large" }, 413);
				}
				const rawBody = await request.text();
				if (Buffer.byteLength(rawBody) > MAX_REPORT_BYTES) {
					return json({ error: "too-large" }, 413);
				}

				let body: Record<string, unknown>;
				try {
					const parsed: unknown = JSON.parse(rawBody);
					if (
						typeof parsed !== "object" ||
						parsed === null ||
						Array.isArray(parsed)
					) {
						return json({ error: "bad-request" }, 400);
					}
					body = parsed as Record<string, unknown>;
				} catch {
					return json({ error: "bad-request" }, 400);
				}
				if (typeof body.session !== "string" || body.session.length > 200) {
					return json({ error: "bad-request" }, 400);
				}

				let session: Awaited<ReturnType<typeof findSession>> = null;
				try {
					session = await findSession(body.session);
					if (!session) return json({ error: "unknown-session" }, 404);

					const secret = await getAppSecret(session.courseId);
					const ts = secret
						? verifyServerSignature({
								secret,
								timestamp: request.headers.get("x-timestamp"),
								signature: request.headers.get("x-signature"),
								rawBody,
							})
						: null;
					if (ts === null) return json({ error: "bad-signature" }, 401);

					const passingScore = await passingScoreOf(session.lessonId);
					if (passingScore === null)
						return json({ error: "unknown-session" }, 404);
					const normalized = normalizeResult(body, passingScore);
					if (!normalized.ok) {
						return json(
							{ error: "invalid-result", message: normalized.message },
							400,
						);
					}

					const outcome = await recordResult({
						courseId: session.courseId,
						lessonId: session.lessonId,
						userId: session.userId,
						source: "server",
						result: normalized.result,
						passed: normalized.passed,
						ts,
					});
					if (!outcome.ok) {
						const status =
							outcome.reason === "stale"
								? 409
								: outcome.reason === "not-enrolled"
									? 403
									: 404;
						return json({ error: outcome.reason }, status);
					}
					return json(
						{
							ok: true,
							passed: outcome.passed,
							lessonCompleted: outcome.lessonCompleted,
							courseCompleted: outcome.courseCompleted,
						},
						200,
					);
				} catch (error) {
					console.error(
						JSON.stringify({
							level: "error",
							msg: "Lesson result report failed",
							lessonId: session?.lessonId,
							courseId: session?.courseId,
							error: error instanceof Error ? error.name : "unknown",
						}),
					);
					return json({ error: "server-error" }, 500);
				}
			},
		},
	},
});

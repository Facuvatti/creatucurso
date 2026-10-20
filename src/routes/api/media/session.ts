import { createFileRoute } from "@tanstack/react-router";
import * as catalog from "../../../areas/catalog/catalog.ts";
import { allLessons } from "../../../areas/catalog/types.ts";
import {
	findPlayableVideo,
	HEARTBEAT_MS,
	startPlayback,
} from "../../../areas/media/playback.ts";
import { accessFor } from "../../../server/access.server.ts";
import { readRequestContext } from "../../../server/request.server.ts";
import { record, text } from "../../../shared/validate.ts";

// POST /api/media/session  { courseSlug, lessonSlug }
// Checks the access (active enrollment, staff or tutor of the course), takes a
// place in the stream cap and returns the master playlist URL with its token.
export const Route = createFileRoute("/api/media/session")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				let input: { courseSlug: string; lessonSlug: string };
				try {
					const body = record(await request.json());
					input = {
						courseSlug: text(body, "courseSlug", 200, 1),
						lessonSlug: text(body, "lessonSlug", 200, 1),
					};
				} catch {
					return Response.json({ error: "bad-request" }, { status: 400 });
				}

				const context = await readRequestContext();
				if (context.host.kind !== "tenant") {
					return Response.json({ error: "not-found" }, { status: 404 });
				}
				const { user } = context;
				if (!user) return Response.json({ error: "login" }, { status: 401 });

				const lookup = await catalog.findCourseBySlug(
					context.host.tenant.id,
					input.courseSlug,
				);
				if (!lookup || lookup.kind !== "found") {
					return Response.json({ error: "not-found" }, { status: 404 });
				}
				const access = await accessFor(context, lookup.course);
				if (!access.canStudy) {
					return Response.json({ error: "denied" }, { status: 403 });
				}
				const lesson = allLessons(lookup.course).find(
					(l) => l.slug === input.lessonSlug,
				);
				const video = lesson ? await findPlayableVideo(lesson.id) : null;
				if (!video) {
					return Response.json({ error: "not-found" }, { status: 404 });
				}

				const started = await startPlayback({
					videoId: video.id,
					userId: user.id,
					staff: access.canManage || access.isInstructor,
				});
				if (!started.ok) {
					return Response.json({ error: "full" }, { status: 429 });
				}
				return Response.json(
					{
						token: started.token,
						manifestUrl: `/api/media/playlist/${video.id}/master?t=${started.token}`,
						heartbeatMs: HEARTBEAT_MS,
					},
					{ headers: { "Cache-Control": "no-store" } },
				);
			},
		},
	},
});

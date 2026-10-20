import { createServerFn } from "@tanstack/react-start";
import * as catalog from "../areas/catalog/catalog.ts";
import {
	courseIdOfLesson,
	mediaConfig,
	prepareUpload,
	removeVideo,
	videosOfCourse,
} from "../areas/media/media.ts";
import type { VideoInfo } from "../areas/media/types.ts";
import { record, uuid } from "../shared/validate.ts";
import { accessFor } from "./access.server.ts";
import { requireStaffContext, requireTenantContext } from "./request.server.ts";

export type UploadStart =
	| {
			ok: true;
			videoId: string;
			token: string;
			endpoint: string;
			maxBytes: number;
	  }
	| { ok: false; message: string };

/** The person manages the lesson's course: owner, admin or tutor of that course. */
async function requireLessonEditor(lessonId: string) {
	const context = await requireTenantContext();
	const { user } = context;
	if (!user) throw new Error("No tenés permiso para hacer esto.");
	const courseId = await courseIdOfLesson(lessonId, context.tenant.id);
	const course = courseId
		? await catalog.findCourseById(context.tenant.id, courseId)
		: null;
	if (!course) throw new Error("No tenés permiso para hacer esto.");
	const access = await accessFor(context, course);
	if (!access.canManage && !access.isInstructor) {
		throw new Error("No tenés permiso para hacer esto.");
	}
	return { tenant: context.tenant, user };
}

/** Registers the video of a lesson and returns what the browser needs to upload it with tus. */
export const startVideoUpload = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		const size = input.size;
		if (typeof size !== "number" || !Number.isSafeInteger(size)) {
			throw new Error("size must be a number of bytes.");
		}
		return { lessonId: uuid(input, "lessonId"), size };
	})
	.handler(async ({ data }): Promise<UploadStart> => {
		const { tenant, user } = await requireLessonEditor(data.lessonId);
		const result = await prepareUpload({
			organizationId: tenant.id,
			userId: user.id,
			lessonId: data.lessonId,
			size: data.size,
		});
		if (!result.ok) return result;
		const config = mediaConfig();
		return {
			ok: true,
			videoId: result.videoId,
			token: result.token,
			endpoint: `${config.publicUrl}/files/`,
			maxBytes: config.maxBytes,
		};
	});

export const removeLessonVideo = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({ lessonId: uuid(record(data), "lessonId") }))
	.handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
		await requireLessonEditor(data.lessonId);
		const removed = await removeVideo(data.lessonId);
		return removed
			? { ok: true }
			: {
					ok: false,
					message: "No se puede quitar un video que se está procesando.",
				};
	});

/** Videos of a course by lesson id, for the panel (polled while one is processing). */
export const getCourseVideos = createServerFn({ method: "GET" })
	.validator((data: unknown) => ({ courseId: uuid(record(data), "courseId") }))
	.handler(async ({ data }): Promise<Record<string, VideoInfo>> => {
		const { tenant } = await requireStaffContext();
		const course = await catalog.findCourseById(tenant.id, data.courseId);
		return course ? videosOfCourse(course.id) : {};
	});

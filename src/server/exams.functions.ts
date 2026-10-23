import { createServerFn } from "@tanstack/react-start";
import * as catalog from "../areas/catalog/catalog.ts";
import * as exams from "../areas/exams/exams.ts";
import {
	type Answers,
	type AttemptResult,
	type AttemptView,
	type ExamListItem,
	type ExamResultRow,
	QUESTION_KINDS,
	type StaffExam,
	type StudentExam,
} from "../areas/exams/types.ts";
import { bool, oneOf, record, text, uuid } from "../shared/validate.ts";
import { accessFor } from "./access.server.ts";
import { requireStaffContext, requireTenantContext } from "./request.server.ts";

// Form exams (ADR-0033). Authoring is for the owner and admins of the academy
// (requireStaffContext); tutors have no access to exams in this phase. Taking is
// for students with an active enrollment, in the academy of the request Host.

type Result = { ok: true } | { ok: false; message: string };

// ----------------------------------------------------------- input checks (trust boundary)

function int(
	input: Record<string, unknown>,
	key: string,
	min: number,
	max: number,
): number {
	const value = input[key];
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < min ||
		value > max
	) {
		throw new Error(`${key} must be a whole number between ${min} and ${max}.`);
	}
	return value;
}

function optionalInt(
	input: Record<string, unknown>,
	key: string,
	min: number,
	max: number,
): number | null {
	return input[key] === null || input[key] === undefined
		? null
		: int(input, key, min, max);
}

function checkCourseExam(data: unknown) {
	const input = record(data);
	return { courseId: uuid(input, "courseId"), examId: uuid(input, "examId") };
}

function checkSettings(data: unknown) {
	const input = record(data);
	const timeLimitMinutes = optionalInt(input, "timeLimitMinutes", 1, 600);
	return {
		courseId: uuid(input, "courseId"),
		examId: input.examId ? uuid(input, "examId") : null,
		settings: {
			title: text(input, "title", 150, 1),
			moduleId: input.moduleId ? uuid(input, "moduleId") : null,
			passingScore: int(input, "passingScore", 0, 100),
			maxAttempts: optionalInt(input, "maxAttempts", 1, 100),
			timeLimitSeconds:
				timeLimitMinutes === null ? null : timeLimitMinutes * 60,
			shuffleQuestions: bool(input, "shuffleQuestions"),
			shuffleOptions: bool(input, "shuffleOptions"),
			showAnswersAfter: bool(input, "showAnswersAfter"),
			required: bool(input, "required"),
		},
	};
}

function checkQuestion(data: unknown) {
	const input = record(data);
	const rawOptions = input.options;
	const rawAccepted = input.accepted;
	if (!Array.isArray(rawOptions) || rawOptions.length > 10) {
		throw new Error("options must be a list of up to 10 items.");
	}
	if (!Array.isArray(rawAccepted) || rawAccepted.length > 20) {
		throw new Error("accepted must be a list of up to 20 items.");
	}
	return {
		courseId: uuid(input, "courseId"),
		examId: uuid(input, "examId"),
		questionId: input.questionId ? uuid(input, "questionId") : null,
		question: {
			kind: oneOf(input, "kind", QUESTION_KINDS),
			prompt: text(input, "prompt", 2000, 1),
			points: int(input, "points", 1, 100),
			options: rawOptions.map((o) => {
				const option = record(o);
				return {
					text: text(option, "text", 300),
					correct: bool(option, "correct"),
				};
			}),
			accepted: rawAccepted.map((a) => {
				const answer = record(a);
				const tolerance = answer.tolerance;
				if (
					tolerance !== null &&
					tolerance !== undefined &&
					(typeof tolerance !== "number" || !(tolerance >= 0))
				) {
					throw new Error("tolerance must be a number of 0 or more.");
				}
				return {
					value: text(answer, "value", 200),
					tolerance: typeof tolerance === "number" ? tolerance : null,
				};
			}),
		},
	};
}

function checkAnswers(data: unknown) {
	const input = record(data);
	const raw = record(input.answers);
	const keys = Object.keys(raw);
	if (keys.length > 500) throw new Error("Too many answers.");
	const answers: Answers = {};
	for (const key of keys) {
		const value = raw[key];
		if (typeof value === "string" && value.length <= 500) {
			answers[key] = value;
		} else if (
			Array.isArray(value) &&
			value.length <= 20 &&
			value.every((v) => typeof v === "string" && v.length <= 100)
		) {
			answers[key] = value as string[];
		} else {
			throw new Error("Each answer must be text or a list of option ids.");
		}
	}
	return {
		attemptId: uuid(input, "attemptId"),
		courseSlug: text(input, "courseSlug", 200, 1),
		answers,
	};
}

// ------------------------------------------------------------------ staff (panel)

const NO_COURSE: Result = { ok: false, message: "No encontramos el curso." };

/** The staff member's academy and the course in it, or null course. */
async function staffCourse(courseId: string) {
	const { tenant } = await requireStaffContext();
	return { tenant, course: await catalog.findCourseById(tenant.id, courseId) };
}

/** Exams of the course with their answer key. Never callable by students. */
export const getPanelExams = createServerFn({ method: "GET" })
	.validator((data: unknown) => ({ courseId: uuid(record(data), "courseId") }))
	.handler(async ({ data }): Promise<StaffExam[]> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return [];
		return exams.listStaffExams(tenant.id, course.id);
	});

export const saveExamSettings = createServerFn({ method: "POST" })
	.validator(checkSettings)
	.handler(async ({ data }): Promise<Result & { examId?: string }> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		const examId = await exams.saveExam(
			tenant.id,
			course.id,
			data.examId,
			data.settings,
		);
		return examId
			? { ok: true, examId }
			: { ok: false, message: "No encontramos el examen." };
	});

export const setExamPublished = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		...checkCourseExam(data),
		published: bool(record(data), "published"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		const problem = await exams.setExamPublished(
			tenant.id,
			course.id,
			data.examId,
			data.published,
		);
		return problem ? { ok: false, message: problem } : { ok: true };
	});

export const deleteExam = createServerFn({ method: "POST" })
	.validator(checkCourseExam)
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		await exams.deleteExam(tenant.id, course.id, data.examId);
		return { ok: true };
	});

export const saveExamQuestion = createServerFn({ method: "POST" })
	.validator(checkQuestion)
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		const problem = await exams.saveQuestion(
			tenant.id,
			course.id,
			data.examId,
			data.questionId,
			data.question,
		);
		return problem ? { ok: false, message: problem } : { ok: true };
	});

export const deleteExamQuestion = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		...checkCourseExam(data),
		questionId: uuid(record(data), "questionId"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		const problem = await exams.deleteQuestion(
			tenant.id,
			course.id,
			data.examId,
			data.questionId,
		);
		return problem ? { ok: false, message: problem } : { ok: true };
	});

/** Submitted attempts of one exam of the course. */
export const getExamResults = createServerFn({ method: "GET" })
	.validator(checkCourseExam)
	.handler(async ({ data }): Promise<ExamResultRow[]> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return [];
		return exams.listExamResults(tenant.id, data.examId);
	});

// ---------------------------------------------------------------------- students

type StudentAccess =
	| {
			kind: "ok";
			organizationId: string;
			userId: string;
			course: { id: string; name: string; slug: string };
	  }
	| { kind: "login" }
	| { kind: "enroll"; course: { name: string; slug: string } }
	| { kind: "notFound" };

/** Resolves the course in the request Host's academy and checks the active enrollment. */
async function studentAccess(courseSlug: string): Promise<StudentAccess> {
	const context = await requireTenantContext();
	const lookup = await catalog.findCourseBySlug(context.tenant.id, courseSlug);
	if (lookup?.kind !== "found") return { kind: "notFound" };
	const { course } = lookup;
	if (!context.user) return { kind: "login" };
	const access = await accessFor(context, course);
	if (!access.enrolled) {
		return { kind: "enroll", course: { name: course.name, slug: course.slug } };
	}
	return {
		kind: "ok",
		organizationId: context.tenant.id,
		userId: context.user.id,
		course: { id: course.id, name: course.name, slug: course.slug },
	};
}

const DENIED: Result = { ok: false, message: "No tenés acceso a este examen." };

/** The published exams of a course for an enrolled student (empty for anyone else). */
export const getCourseExams = createServerFn({ method: "GET" })
	.validator((data: unknown) => ({
		courseSlug: text(record(data), "courseSlug", 200, 1),
	}))
	.handler(async ({ data }): Promise<ExamListItem[]> => {
		const access = await studentAccess(data.courseSlug);
		if (access.kind !== "ok") return [];
		return exams.listCourseExams(
			access.organizationId,
			access.course.id,
			access.userId,
		);
	});

export type ExamPageData =
	| {
			kind: "ok";
			course: { name: string; slug: string };
			exam: StudentExam;
	  }
	| { kind: "login" }
	| { kind: "enroll"; course: { name: string; slug: string } }
	| { kind: "notFound" };

const checkStudentExam = (data: unknown) => {
	const input = record(data);
	return {
		courseSlug: text(input, "courseSlug", 200, 1),
		examId: uuid(input, "examId"),
	};
};

export const getExamPage = createServerFn({ method: "GET" })
	.validator(checkStudentExam)
	.handler(async ({ data }): Promise<ExamPageData> => {
		const access = await studentAccess(data.courseSlug);
		if (access.kind !== "ok") return access;
		const exam = await exams.getStudentExam(
			access.organizationId,
			access.course.id,
			data.examId,
			access.userId,
		);
		if (!exam) return { kind: "notFound" };
		return {
			kind: "ok",
			course: { name: access.course.name, slug: access.course.slug },
			exam,
		};
	});

/** Starts (or resumes) an attempt. The questions it returns carry no answer key. */
export const startExam = createServerFn({ method: "POST" })
	.validator(checkStudentExam)
	.handler(
		async ({
			data,
		}): Promise<
			{ ok: true; view: AttemptView } | { ok: false; message: string }
		> => {
			const access = await studentAccess(data.courseSlug);
			if (access.kind !== "ok") return DENIED;
			return exams.startAttempt(
				access.organizationId,
				access.course.id,
				data.examId,
				access.userId,
			);
		},
	);

/** Grades the attempt on the server and returns the result. */
export const submitExam = createServerFn({ method: "POST" })
	.validator(checkAnswers)
	.handler(
		async ({
			data,
		}): Promise<
			{ ok: true; result: AttemptResult } | { ok: false; message: string }
		> => {
			const access = await studentAccess(data.courseSlug);
			if (access.kind !== "ok") return DENIED;
			return exams.submitAttempt(
				access.organizationId,
				access.course.id,
				access.userId,
				data.attemptId,
				data.answers,
			);
		},
	);

/** A past attempt of the signed-in student. */
export const getExamAttempt = createServerFn({ method: "GET" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			courseSlug: text(input, "courseSlug", 200, 1),
			attemptId: uuid(input, "attemptId"),
		};
	})
	.handler(async ({ data }): Promise<AttemptResult | null> => {
		const access = await studentAccess(data.courseSlug);
		if (access.kind !== "ok") return null;
		return exams.getAttemptResult(
			access.organizationId,
			access.course.id,
			access.userId,
			data.attemptId,
		);
	});

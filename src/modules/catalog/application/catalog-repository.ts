import type {
	CourseOutline,
	CourseStatus,
	CourseSummary,
	NewCourse,
} from "../domain/types.ts";

export type CourseLookup =
	| { kind: "found"; course: CourseOutline }
	| { kind: "moved"; slug: string };

export type CompletionResult = {
	courseCompleted: boolean;
	justCompleted: boolean;
};

export interface CatalogRepository {
	createCourse(
		organizationId: string,
		course: NewCourse,
	): Promise<{ id: string }>;
	listCourses(
		organizationId: string,
		options: { publishedOnly: boolean },
	): Promise<CourseSummary[]>;
	findBySlug(
		organizationId: string,
		slug: string,
	): Promise<CourseLookup | null>;
	findById(organizationId: string, id: string): Promise<CourseOutline | null>;
	setStatus(
		organizationId: string,
		courseId: string,
		status: CourseStatus,
	): Promise<boolean>;
	/** Sets the price in minor units, or removes it (free course) with null. */
	setPrice(
		organizationId: string,
		courseId: string,
		price: { amount: number; currency: string } | null,
	): Promise<boolean>;
	/** Changes the address of a course and keeps the old one so it keeps working. */
	renameSlug(
		organizationId: string,
		courseId: string,
		newSlug: string,
	): Promise<void>;
	addModule(courseId: string, title: string): Promise<void>;
	addLesson(
		moduleId: string,
		lesson: { title: string; description: string | null },
	): Promise<void>;
	enroll(input: {
		courseId: string;
		userId: string;
		source: "manual" | "payment" | "free";
		paymentId?: string;
	}): Promise<boolean>;
	findEnrollment(
		courseId: string,
		userId: string,
	): Promise<{ completedAt: Date | null } | null>;
	completedLessonIds(courseId: string, userId: string): Promise<string[]>;
	completeLesson(
		courseId: string,
		lessonId: string,
		userId: string,
	): Promise<CompletionResult>;
}

export type MediaRef = {
	/** Where the creator keeps the file; the server never reads this path. */
	ref: string;
	name: string;
	status: "pending" | "ready";
};

export function toMediaRef(ref: string): MediaRef {
	const name = ref.split(/[\\/]/).filter(Boolean).pop() ?? ref;
	return { ref, name, status: "pending" };
}

export type CourseStatus = "draft" | "published";

export type CourseSummary = {
	id: string;
	slug: string;
	name: string;
	shortDescription: string | null;
	status: CourseStatus;
};

export type Lesson = {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	position: number;
	videos: MediaRef[];
	notes: MediaRef[];
};

export type Module = {
	id: string;
	title: string;
	description: string | null;
	position: number;
	lessons: Lesson[];
};

export type CourseOutline = CourseSummary & {
	organizationId: string;
	longDescription: string | null;
	coverImages: MediaRef[];
	promoVideo: MediaRef | null;
	requirements: string[];
	learningGoals: string[];
	targetStudents: string[];
	instructorIds: string[];
	modules: Module[];
};

export type NewLesson = Omit<Lesson, "id">;
export type NewModule = Omit<Module, "id" | "lessons"> & {
	lessons: NewLesson[];
};
export type NewCourse = {
	slug: string;
	name: string;
	shortDescription: string | null;
	longDescription: string | null;
	coverImages: MediaRef[];
	promoVideo: MediaRef | null;
	requirements: string[];
	learningGoals: string[];
	targetStudents: string[];
	instructorIds: string[];
	modules: NewModule[];
};

export class SlugTakenError extends Error {
	constructor(readonly slug: string) {
		super(`The address "${slug}" is already used by another course.`);
	}
}

export function firstLesson(course: CourseOutline): Lesson | null {
	return course.modules.flatMap((module) => module.lessons)[0] ?? null;
}

export function allLessons(course: CourseOutline): Lesson[] {
	return course.modules.flatMap((module) => module.lessons);
}

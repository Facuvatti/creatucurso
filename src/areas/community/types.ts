export type Review = {
	id: string;
	userId: string;
	authorName: string;
	rating: number;
	body: string;
	hidden: boolean;
	createdAt: string;
};

export type ReviewSummary = { count: number; average: number | null };

export type FeaturedReview = Review & { courseId: string };

export type AuthorKind = "staff" | "tutor" | "student";

export type Comment = {
	id: string;
	userId: string;
	authorName: string;
	authorKind: AuthorKind;
	parentId: string | null;
	body: string;
	hidden: boolean;
	createdAt: string;
};

export type PendingComment = {
	id: string;
	courseId: string;
	lessonId: string;
	authorName: string;
	body: string;
	createdAt: string;
};

/** Staff and tutors are shown differently from students next to their comments. */
export function authorKindOf(roles: readonly string[]): AuthorKind {
	if (roles.includes("owner") || roles.includes("admin")) return "staff";
	if (roles.includes("tutor")) return "tutor";
	return "student";
}

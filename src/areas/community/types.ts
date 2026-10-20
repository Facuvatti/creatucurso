export type ReviewReply = { body: string; createdAt: string };

export type Review = {
	id: string;
	userId: string;
	authorName: string;
	rating: number;
	body: string;
	hidden: boolean;
	/** The academy's public answer, shown under the review. */
	reply: ReviewReply | null;
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
	/** Empty for a deleted comment: only a tombstone is shown. */
	body: string;
	hidden: boolean;
	deleted: boolean;
	answered: boolean;
	pinned: boolean;
	/** Open reports; only moderators get the real number. */
	reports: number;
	reportedByMe: boolean;
	createdAt: string;
};

export type PendingComment = {
	id: string;
	/** The top-level comment of the thread: where replies go and what "answered" marks. */
	threadId: string;
	courseId: string;
	lessonId: string;
	authorName: string;
	body: string;
	createdAt: string;
};

export type ReportedComment = {
	id: string;
	courseId: string;
	lessonId: string;
	authorId: string;
	authorName: string;
	authorMuted: boolean;
	body: string;
	hidden: boolean;
	reports: number;
	createdAt: string;
};

/** Staff and tutors are shown differently from students next to their comments. */
export function authorKindOf(roles: readonly string[]): AuthorKind {
	if (roles.includes("owner") || roles.includes("admin")) return "staff";
	if (roles.includes("tutor")) return "tutor";
	return "student";
}

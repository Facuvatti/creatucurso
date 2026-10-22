// Shapes shared by the server and the pages. Type-only: nothing here reaches the
// database. The "Student*" shapes carry NO correctness data (ADR-0033).

export type QuestionKind =
	| "single"
	| "multiple"
	| "truefalse"
	| "short_text"
	| "numeric";

export const QUESTION_KINDS: readonly QuestionKind[] = [
	"single",
	"multiple",
	"truefalse",
	"short_text",
	"numeric",
];

/** What a student answered: option ids for choice questions, text for the rest. */
export type Answer = string[] | string;
export type Answers = Record<string, Answer>;

export type ExamSettings = {
	title: string;
	moduleId: string | null;
	passingScore: number;
	maxAttempts: number | null;
	timeLimitSeconds: number | null;
	shuffleQuestions: boolean;
	shuffleOptions: boolean;
	showAnswersAfter: boolean;
	required: boolean;
};

// ------------------------------------------------------------------- staff side

/** An exam with its answer key. Only staff ever receive this. */
export type StaffExam = ExamSettings & {
	id: string;
	published: boolean;
	attemptCount: number;
	questions: {
		id: string;
		kind: QuestionKind;
		prompt: string;
		points: number;
		options: { id: string; text: string; correct: boolean }[];
		accepted: { value: string; tolerance: number | null }[];
	}[];
};

export type ExamResultRow = {
	attemptId: string;
	studentName: string;
	studentEmail: string;
	submittedAt: string;
	score: number;
	passed: boolean;
	expired: boolean;
};

// ----------------------------------------------------------------- student side

export type ExamListItem = {
	id: string;
	title: string;
	required: boolean;
	passed: boolean;
	attemptsUsed: number;
	maxAttempts: number | null;
};

/** The questions of one attempt, in this attempt's order, with no answer key. */
export type AttemptView = {
	attemptId: string;
	deadline: string | null;
	questions: {
		id: string;
		kind: QuestionKind;
		prompt: string;
		points: number;
		options: { id: string; text: string }[];
	}[];
};

export type ReviewItem = {
	questionId: string;
	prompt: string;
	kind: QuestionKind;
	correct: boolean;
	given: Answer | null;
	options: { id: string; text: string; correct: boolean }[];
	accepted: string[];
};

export type AttemptResult = {
	attemptId: string;
	score: number;
	passed: boolean;
	expired: boolean;
	submittedAt: string;
	/** Present only when the exam shows the answers after submission. */
	review: ReviewItem[] | null;
};

export type StudentExam = {
	id: string;
	title: string;
	passingScore: number;
	maxAttempts: number | null;
	timeLimitSeconds: number | null;
	required: boolean;
	passed: boolean;
	attempts: { attemptId: string; submittedAt: string; score: number; passed: boolean; expired: boolean }[];
	/** An attempt started and not yet submitted (resumed on reload). */
	open: AttemptView | null;
};

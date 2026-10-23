import type { PoolClient } from "pg";
import { emitEvent, inTransaction, pool } from "../../server/db.server.ts";
import { completeCourseIfDone } from "../catalog/catalog.ts";
import type {
	Answer,
	Answers,
	AttemptResult,
	AttemptView,
	ExamListItem,
	ExamResultRow,
	ExamSettings,
	QuestionKind,
	ReviewItem,
	StaffExam,
	StudentExam,
} from "./types.ts";

// Form exams (ADR-0033). The answer key (option.correct, accepted_answer) is read
// only by `loadKey`, which is used for grading, for the staff editor and for the
// post-submission review. Every student-facing read below selects no key column.

/** Seconds granted after the time limit for the request to arrive. */
const GRACE_SECONDS = 10;

type QuestionKey = {
	id: string;
	kind: QuestionKind;
	prompt: string;
	points: number;
	options: { id: string; text: string; correct: boolean }[];
	accepted: { value: string; tolerance: number | null }[];
};

type Layout = { questions: string[]; options: Record<string, string[]> };

/** Questions in order, each with its answer key. Server-only. */
async function loadKey(
	client: PoolClient,
	examId: string,
): Promise<QuestionKey[]> {
	const questions = await client.query<{
		id: string;
		kind: QuestionKind;
		prompt: string;
		points: number;
	}>(
		`select id, kind, prompt, points from exams.question
		 where exam_id = $1 order by position`,
		[examId],
	);
	const ids = questions.rows.map((q) => q.id);
	const options = await client.query<{
		id: string;
		question_id: string;
		text: string;
		correct: boolean;
	}>(
		`select id, question_id, text, correct from exams.option
		 where question_id = any ($1::uuid[]) order by position`,
		[ids],
	);
	const accepted = await client.query<{
		question_id: string;
		value: string;
		numeric_tolerance: string | null;
	}>(
		`select question_id, value, numeric_tolerance from exams.accepted_answer
		 where question_id = any ($1::uuid[]) order by id`,
		[ids],
	);
	return questions.rows.map((q) => ({
		...q,
		options: options.rows
			.filter((o) => o.question_id === q.id)
			.map((o) => ({ id: o.id, text: o.text, correct: o.correct })),
		accepted: accepted.rows
			.filter((a) => a.question_id === q.id)
			.map((a) => ({
				value: a.value,
				tolerance:
					a.numeric_tolerance === null ? null : Number(a.numeric_tolerance),
			})),
	}));
}

// -------------------------------------------------------------------- grading

function normalizeText(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseNumber(value: string): number | null {
	const trimmed = value.trim().replace(",", ".");
	if (trimmed === "") return null;
	const number = Number(trimmed);
	return Number.isFinite(number) ? number : null;
}

function isCorrect(question: QuestionKey, answer: Answer | undefined): boolean {
	if (answer === undefined) return false;
	if (question.kind === "short_text") {
		if (typeof answer !== "string") return false;
		const given = normalizeText(answer);
		return (
			given !== "" &&
			question.accepted.some((a) => normalizeText(a.value) === given)
		);
	}
	if (question.kind === "numeric") {
		if (typeof answer !== "string") return false;
		const given = parseNumber(answer);
		if (given === null) return false;
		return question.accepted.some((a) => {
			const value = parseNumber(a.value);
			return (
				value !== null && Math.abs(given - value) <= (a.tolerance ?? 0) + 1e-9
			);
		});
	}
	// single, multiple, truefalse: the chosen set must equal the correct set.
	if (!Array.isArray(answer)) return false;
	const given = new Set(answer);
	const correct = question.options.filter((o) => o.correct).map((o) => o.id);
	return given.size === correct.length && correct.every((id) => given.has(id));
}

/** Percentage (0-100, rounded) of the exam's points earned. */
function gradeAnswers(key: QuestionKey[], answers: Answers): number {
	let total = 0;
	let earned = 0;
	for (const question of key) {
		total += question.points;
		if (isCorrect(question, answers[question.id])) earned += question.points;
	}
	return total === 0 ? 0 : Math.round((earned / total) * 100);
}

/** Only answers to questions of this exam are kept. */
function keepKnownAnswers(key: QuestionKey[], answers: Answers): Answers {
	const kept: Answers = {};
	for (const question of key) {
		const answer = answers[question.id];
		if (answer !== undefined) kept[question.id] = answer;
	}
	return kept;
}

function reviewOf(
	key: QuestionKey[],
	layout: Layout,
	answers: Answers,
): ReviewItem[] {
	const order = layout.questions.length > 0 ? layout.questions : null;
	const questions = order
		? order
				.map((id) => key.find((q) => q.id === id))
				.filter((q): q is QuestionKey => q !== undefined)
		: key;
	return questions.map((q) => {
		const optionOrder = layout.options[q.id];
		return {
			questionId: q.id,
			prompt: q.prompt,
			kind: q.kind,
			correct: isCorrect(q, answers[q.id]),
			given: answers[q.id] ?? null,
			options: optionOrder
				? optionOrder
						.map((id) => q.options.find((o) => o.id === id))
						.filter((o): o is QuestionKey["options"][number] => o !== undefined)
				: q.options,
			accepted: q.accepted.map((a) =>
				a.tolerance ? `${a.value} (± ${a.tolerance})` : a.value,
			),
		};
	});
}

// -------------------------------------------------------------------- authoring
// Callers pass the organization of the request Host and have already checked
// that the person is owner or admin of it.

function mapSettings(exam: Record<string, unknown>): ExamSettings {
	return {
		title: String(exam.title),
		moduleId: (exam.module_id as string | null) ?? null,
		passingScore: Number(exam.passing_score),
		maxAttempts: exam.max_attempts === null ? null : Number(exam.max_attempts),
		timeLimitSeconds:
			exam.time_limit_seconds === null ? null : Number(exam.time_limit_seconds),
		shuffleQuestions: Boolean(exam.shuffle_questions),
		shuffleOptions: Boolean(exam.shuffle_options),
		showAnswersAfter: Boolean(exam.show_answers_after),
		required: Boolean(exam.required),
	};
}

/** Every exam of the course with its answer key. Staff only. */
export async function listStaffExams(
	organizationId: string,
	courseId: string,
): Promise<StaffExam[]> {
	return inTransaction(async (client) => {
		const exams = await client.query<Record<string, unknown>>(
			`select e.*,
			        (select count(*) from exams.attempt a where a.exam_id = e.id) as attempt_count
			 from exams.exam e
			 where e.organization_id = $1 and e.course_id = $2
			 order by e.created_at`,
			[organizationId, courseId],
		);
		const result: StaffExam[] = [];
		for (const exam of exams.rows) {
			result.push({
				id: String(exam.id),
				published: Boolean(exam.published),
				attemptCount: Number(exam.attempt_count),
				...mapSettings(exam),
				questions: await loadKey(client, String(exam.id)),
			});
		}
		return result;
	});
}

/** Creates the exam (examId null) or updates its settings. Returns the exam id. */
export async function saveExam(
	organizationId: string,
	courseId: string,
	examId: string | null,
	s: ExamSettings,
): Promise<string | null> {
	const values = [
		s.title,
		s.moduleId,
		s.passingScore,
		s.maxAttempts,
		s.timeLimitSeconds,
		s.shuffleQuestions,
		s.shuffleOptions,
		s.showAnswersAfter,
		s.required,
	];
	// A module of another course is ignored (stored as null).
	const moduleCheck = `(select id from catalog.module where id = $2::uuid and course_id = $11::uuid)`;
	if (examId === null) {
		const { rows } = await pool.query<{ id: string }>(
			`insert into exams.exam
			 (title, module_id, passing_score, max_attempts, time_limit_seconds, shuffle_questions,
			  shuffle_options, show_answers_after, required, organization_id, course_id)
			 values ($1, ${moduleCheck}, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
			[...values, organizationId, courseId],
		);
		return rows[0]?.id ?? null;
	}
	const { rows } = await pool.query<{ id: string }>(
		`update exams.exam set title = $1, module_id = ${moduleCheck}, passing_score = $3,
		   max_attempts = $4, time_limit_seconds = $5, shuffle_questions = $6,
		   shuffle_options = $7, show_answers_after = $8, required = $9
		 where id = $12 and organization_id = $10 and course_id = $11 returning id`,
		[...values, organizationId, courseId, examId],
	);
	return rows[0]?.id ?? null;
}

/** Returns an error message, or null when it worked. */
export async function setExamPublished(
	organizationId: string,
	courseId: string,
	examId: string,
	published: boolean,
): Promise<string | null> {
	const { rowCount } = await pool.query(
		`update exams.exam set published = $4::boolean
		 where id = $1 and organization_id = $2 and course_id = $3
		   and ($4::boolean = false or exists (select 1 from exams.question where exam_id = $1))`,
		[examId, organizationId, courseId, published],
	);
	return (rowCount ?? 0) > 0
		? null
		: "Agregá al menos una pregunta antes de publicar el examen.";
}

/** Deleting an exam deletes its questions and attempts (cascade). */
export async function deleteExam(
	organizationId: string,
	courseId: string,
	examId: string,
): Promise<void> {
	await pool.query(
		`delete from exams.exam where id = $1 and organization_id = $2 and course_id = $3`,
		[examId, organizationId, courseId],
	);
}

export type QuestionInput = {
	kind: QuestionKind;
	prompt: string;
	points: number;
	options: { text: string; correct: boolean }[];
	accepted: { value: string; tolerance: number | null }[];
};

/** The first thing wrong with a question (Spanish, shown to the creator), or null. */
function questionProblem(q: QuestionInput): string | null {
	if (q.kind === "single" || q.kind === "multiple") {
		if (q.options.length < 2) return "Poné al menos dos opciones.";
		if (q.options.some((o) => o.text === "")) return "Hay opciones vacías.";
		const correct = q.options.filter((o) => o.correct).length;
		if (q.kind === "single" && correct !== 1) {
			return "Marcá exactamente una opción correcta.";
		}
		if (q.kind === "multiple" && correct < 1) {
			return "Marcá al menos una opción correcta.";
		}
	} else if (q.kind === "truefalse") {
		if (q.options.filter((o) => o.correct).length !== 1) {
			return "Elegí si la respuesta correcta es verdadero o falso.";
		}
	} else {
		if (q.accepted.length === 0)
			return "Cargá al menos una respuesta aceptada.";
		if (q.accepted.some((a) => a.value === "")) return "Hay respuestas vacías.";
		if (
			q.kind === "numeric" &&
			q.accepted.some((a) => parseNumber(a.value) === null)
		) {
			return "Las respuestas numéricas deben ser números.";
		}
	}
	return null;
}

/**
 * Creates (questionId null) or replaces a question with its options / accepted
 * answers. Frozen once the exam has attempts, so stored answers keep their meaning.
 * Returns an error message, or null when it worked.
 */
export async function saveQuestion(
	organizationId: string,
	courseId: string,
	examId: string,
	questionId: string | null,
	q: QuestionInput,
): Promise<string | null> {
	const problem = questionProblem(q);
	if (problem) return problem;

	return inTransaction(async (client) => {
		const exam = await client.query(
			`select id from exams.exam
			 where id = $1 and organization_id = $2 and course_id = $3 for update`,
			[examId, organizationId, courseId],
		);
		if (exam.rows.length === 0) return "No encontramos el examen.";
		const attempts = await client.query(
			`select 1 from exams.attempt where exam_id = $1 limit 1`,
			[examId],
		);
		if (attempts.rows.length > 0) {
			return "Este examen ya tiene intentos: no se pueden cambiar las preguntas.";
		}

		let id = questionId;
		if (id === null) {
			const created = await client.query<{ id: string }>(
				`insert into exams.question (exam_id, position, kind, prompt, points)
				 values ($1,
				   coalesce((select max(position) from exams.question where exam_id = $1), 0) + 1,
				   $2, $3, $4) returning id`,
				[examId, q.kind, q.prompt, q.points],
			);
			id = created.rows[0]?.id ?? null;
		} else {
			const updated = await client.query(
				`update exams.question set kind = $3, prompt = $4, points = $5
				 where id = $1 and exam_id = $2`,
				[id, examId, q.kind, q.prompt, q.points],
			);
			if (updated.rowCount === 0) return "No encontramos la pregunta.";
			await client.query(`delete from exams.option where question_id = $1`, [
				id,
			]);
			await client.query(
				`delete from exams.accepted_answer where question_id = $1`,
				[id],
			);
		}
		if (id === null) return "No se pudo guardar la pregunta.";

		if (q.kind === "short_text" || q.kind === "numeric") {
			for (const a of q.accepted) {
				await client.query(
					`insert into exams.accepted_answer (question_id, value, numeric_tolerance)
					 values ($1, $2, $3)`,
					[id, a.value, q.kind === "numeric" ? (a.tolerance ?? 0) : null],
				);
			}
		} else {
			const options =
				q.kind === "truefalse"
					? [
							{ text: "Verdadero", correct: q.options[0]?.correct === true },
							{ text: "Falso", correct: q.options[1]?.correct === true },
						]
					: q.options;
			for (const [index, o] of options.entries()) {
				await client.query(
					`insert into exams.option (question_id, position, text, correct)
					 values ($1, $2, $3, $4)`,
					[id, index + 1, o.text, o.correct],
				);
			}
		}
		return null;
	});
}

export async function deleteQuestion(
	organizationId: string,
	courseId: string,
	examId: string,
	questionId: string,
): Promise<string | null> {
	return inTransaction(async (client) => {
		const exam = await client.query(
			`select id from exams.exam
			 where id = $1 and organization_id = $2 and course_id = $3 for update`,
			[examId, organizationId, courseId],
		);
		if (exam.rows.length === 0) return "No encontramos el examen.";
		const attempts = await client.query(
			`select 1 from exams.attempt where exam_id = $1 limit 1`,
			[examId],
		);
		if (attempts.rows.length > 0) {
			return "Este examen ya tiene intentos: no se pueden cambiar las preguntas.";
		}
		await client.query(
			`delete from exams.question where id = $1 and exam_id = $2`,
			[questionId, examId],
		);
		return null;
	});
}

/** Submitted attempts of an exam of this academy, newest first. */
export async function listExamResults(
	organizationId: string,
	examId: string,
): Promise<ExamResultRow[]> {
	const { rows } = await pool.query<{
		id: string;
		name: string;
		email: string;
		submitted_at: Date;
		score: number;
		passed: boolean;
		expired: boolean;
	}>(
		`select a.id, u.name, u.email, a.submitted_at, a.score, a.passed, a.expired
		 from exams.attempt a
		 join exams.exam e on e.id = a.exam_id
		 join auth."user" u on u.id = a.user_id
		 where a.exam_id = $1 and e.organization_id = $2 and a.submitted_at is not null
		 order by a.submitted_at desc limit 500`,
		[examId, organizationId],
	);
	return rows.map((r) => ({
		attemptId: r.id,
		studentName: r.name,
		studentEmail: r.email,
		submittedAt: r.submitted_at.toISOString(),
		score: r.score,
		passed: r.passed,
		expired: r.expired,
	}));
}

// ----------------------------------------------------------------------- taking
// Callers have checked that the person has an active enrollment in the course.

/** Published exams of the course with this student's progress. */
export async function listCourseExams(
	organizationId: string,
	courseId: string,
	userId: string,
): Promise<ExamListItem[]> {
	const { rows } = await pool.query<{
		id: string;
		title: string;
		required: boolean;
		max_attempts: number | null;
		used: string;
		passed: boolean;
	}>(
		`select e.id, e.title, e.required, e.max_attempts,
		        (select count(*) from exams.attempt a where a.exam_id = e.id and a.user_id = $3) as used,
		        exists (select 1 from exams.attempt a
		                 where a.exam_id = e.id and a.user_id = $3 and a.passed) as passed
		 from exams.exam e
		 where e.organization_id = $1 and e.course_id = $2 and e.published
		 order by e.created_at`,
		[organizationId, courseId, userId],
	);
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		required: r.required,
		passed: r.passed,
		attemptsUsed: Number(r.used),
		maxAttempts: r.max_attempts,
	}));
}

type ExamRow = {
	id: string;
	title: string;
	passing_score: number;
	max_attempts: number | null;
	time_limit_seconds: number | null;
	shuffle_questions: boolean;
	shuffle_options: boolean;
	required: boolean;
};

async function findPublishedExam(
	client: PoolClient,
	organizationId: string,
	courseId: string,
	examId: string,
): Promise<ExamRow | null> {
	const { rows } = await client.query<ExamRow>(
		`select id, title, passing_score, max_attempts, time_limit_seconds,
		        shuffle_questions, shuffle_options, required
		 from exams.exam
		 where id = $1 and organization_id = $2 and course_id = $3 and published`,
		[examId, organizationId, courseId],
	);
	return rows[0] ?? null;
}

/** The student's open attempt of the exam, closed as expired when its time is up. */
async function findOpenAttempt(
	client: PoolClient,
	examId: string,
	userId: string,
): Promise<{ id: string; started_at: Date; layout: Layout } | null> {
	const { rows } = await client.query<{
		id: string;
		started_at: Date;
		layout: Layout;
		late: boolean;
	}>(
		`select a.id, a.started_at, a.layout,
		        (e.time_limit_seconds is not null
		         and now() > a.started_at + make_interval(secs => e.time_limit_seconds + $3::int)) as late
		 from exams.attempt a join exams.exam e on e.id = a.exam_id
		 where a.exam_id = $1 and a.user_id = $2 and a.submitted_at is null`,
		[examId, userId, GRACE_SECONDS],
	);
	const open = rows[0];
	if (!open) return null;
	if (open.late) {
		// Nothing was submitted in time: it counts as an attempt, scored 0.
		await client.query(
			`update exams.attempt
			 set submitted_at = now(), score = 0, passed = false, expired = true
			 where id = $1`,
			[open.id],
		);
		return null;
	}
	return open;
}

/** The questions of an attempt in its stored order. Selects no answer key. */
async function attemptView(
	client: PoolClient,
	attempt: { id: string; started_at: Date; layout: Layout },
	timeLimitSeconds: number | null,
): Promise<AttemptView> {
	const questions = await client.query<{
		id: string;
		kind: QuestionKind;
		prompt: string;
		points: number;
	}>(
		`select id, kind, prompt, points from exams.question where id = any ($1::uuid[])`,
		[attempt.layout.questions],
	);
	const options = await client.query<{
		id: string;
		question_id: string;
		text: string;
	}>(
		`select id, question_id, text from exams.option where question_id = any ($1::uuid[])`,
		[attempt.layout.questions],
	);
	return {
		attemptId: attempt.id,
		deadline:
			timeLimitSeconds === null
				? null
				: new Date(
						attempt.started_at.getTime() + timeLimitSeconds * 1000,
					).toISOString(),
		questions: attempt.layout.questions.flatMap((questionId) => {
			const q = questions.rows.find((row) => row.id === questionId);
			if (!q) return [];
			const own = options.rows.filter((o) => o.question_id === q.id);
			const order = attempt.layout.options[q.id] ?? own.map((o) => o.id);
			return [
				{
					...q,
					options: order.flatMap((id) => {
						const o = own.find((row) => row.id === id);
						return o ? [{ id: o.id, text: o.text }] : [];
					}),
				},
			];
		}),
	};
}

/** The exam as one student sees it: settings, own attempts and the open attempt. */
export async function getStudentExam(
	organizationId: string,
	courseId: string,
	examId: string,
	userId: string,
): Promise<StudentExam | null> {
	return inTransaction(async (client) => {
		const exam = await findPublishedExam(
			client,
			organizationId,
			courseId,
			examId,
		);
		if (!exam) return null;
		const open = await findOpenAttempt(client, examId, userId);
		const attempts = await client.query<{
			id: string;
			submitted_at: Date;
			score: number;
			passed: boolean;
			expired: boolean;
		}>(
			`select id, submitted_at, score, passed, expired from exams.attempt
			 where exam_id = $1 and user_id = $2 and submitted_at is not null
			 order by submitted_at desc`,
			[examId, userId],
		);
		return {
			id: exam.id,
			title: exam.title,
			passingScore: exam.passing_score,
			maxAttempts: exam.max_attempts,
			timeLimitSeconds: exam.time_limit_seconds,
			required: exam.required,
			passed: attempts.rows.some((a) => a.passed),
			attempts: attempts.rows.map((a) => ({
				attemptId: a.id,
				submittedAt: a.submitted_at.toISOString(),
				score: a.score,
				passed: a.passed,
				expired: a.expired,
			})),
			open: open
				? await attemptView(client, open, exam.time_limit_seconds)
				: null,
		};
	});
}

function shuffled<T>(items: T[]): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
	}
	return copy;
}

/**
 * Starts an attempt, or resumes the open one. Refuses when the student already
 * passed or used every allowed attempt. The shuffled order is stored on the attempt.
 */
export async function startAttempt(
	organizationId: string,
	courseId: string,
	examId: string,
	userId: string,
): Promise<{ ok: true; view: AttemptView } | { ok: false; message: string }> {
	try {
		return await inTransaction(async (client) => {
			const exam = await findPublishedExam(
				client,
				organizationId,
				courseId,
				examId,
			);
			if (!exam)
				return { ok: false as const, message: "No encontramos el examen." };

			const passed = await client.query(
				`select 1 from exams.attempt where exam_id = $1 and user_id = $2 and passed limit 1`,
				[examId, userId],
			);
			if (passed.rows.length > 0) {
				return { ok: false as const, message: "Ya aprobaste este examen." };
			}

			const open = await findOpenAttempt(client, examId, userId);
			if (open) {
				return {
					ok: true as const,
					view: await attemptView(client, open, exam.time_limit_seconds),
				};
			}

			const used = await client.query<{ count: string }>(
				`select count(*) from exams.attempt where exam_id = $1 and user_id = $2`,
				[examId, userId],
			);
			if (
				exam.max_attempts !== null &&
				Number(used.rows[0]?.count) >= exam.max_attempts
			) {
				return {
					ok: false as const,
					message: "Ya usaste todos los intentos de este examen.",
				};
			}

			const questions = await client.query<{ id: string; kind: QuestionKind }>(
				`select id, kind from exams.question where exam_id = $1 order by position`,
				[examId],
			);
			if (questions.rows.length === 0) {
				return {
					ok: false as const,
					message: "Este examen todavía no tiene preguntas.",
				};
			}
			const options = await client.query<{ id: string; question_id: string }>(
				`select id, question_id from exams.option
				 where question_id = any ($1::uuid[]) order by position`,
				[questions.rows.map((q) => q.id)],
			);
			const ids = questions.rows.map((q) => q.id);
			const layout: Layout = {
				questions: exam.shuffle_questions ? shuffled(ids) : ids,
				options: {},
			};
			for (const q of questions.rows) {
				const own = options.rows
					.filter((o) => o.question_id === q.id)
					.map((o) => o.id);
				// True / false keeps its order.
				layout.options[q.id] =
					exam.shuffle_options && q.kind !== "truefalse" ? shuffled(own) : own;
			}

			const created = await client.query<{ id: string; started_at: Date }>(
				`insert into exams.attempt (exam_id, user_id, layout)
				 values ($1, $2, $3) returning id, started_at`,
				[examId, userId, JSON.stringify(layout)],
			);
			const attempt = created.rows[0] as { id: string; started_at: Date };
			return {
				ok: true as const,
				view: await attemptView(
					client,
					{ ...attempt, layout },
					exam.time_limit_seconds,
				),
			};
		});
	} catch (error) {
		// attempt_one_open_idx: a second click raced the first one.
		if ((error as { code?: string }).code === "23505") {
			return {
				ok: false,
				message: "Ya hay un intento en curso. Recargá la página.",
			};
		}
		throw error;
	}
}

/**
 * Grades the attempt right away. After the time limit (plus a few seconds of grace)
 * the attempt is stored as expired: score 0, never passed. Passing emits `exam.passed`
 * and re-checks the course completion rule.
 */
export async function submitAttempt(
	organizationId: string,
	courseId: string,
	userId: string,
	attemptId: string,
	given: Answers,
): Promise<
	{ ok: true; result: AttemptResult } | { ok: false; message: string }
> {
	return inTransaction(async (client) => {
		const found = await client.query<{
			exam_id: string;
			layout: Layout;
			passing_score: number;
			show_answers_after: boolean;
			late: boolean;
		}>(
			`select a.exam_id, a.layout, e.passing_score, e.show_answers_after,
			        (e.time_limit_seconds is not null
			         and now() > a.started_at + make_interval(secs => e.time_limit_seconds + $5::int)) as late
			 from exams.attempt a join exams.exam e on e.id = a.exam_id
			 where a.id = $1 and a.user_id = $2 and e.course_id = $3 and e.organization_id = $4
			   and a.submitted_at is null
			 for update of a`,
			[attemptId, userId, courseId, organizationId, GRACE_SECONDS],
		);
		const attempt = found.rows[0];
		if (!attempt) {
			return {
				ok: false as const,
				message: "Ese intento ya fue enviado o no existe.",
			};
		}

		const key = await loadKey(client, attempt.exam_id);
		const answers = keepKnownAnswers(key, given);
		const expired = attempt.late;
		const score = expired ? 0 : gradeAnswers(key, answers);
		const passed = !expired && score >= attempt.passing_score;

		const saved = await client.query<{ submitted_at: Date }>(
			`update exams.attempt
			 set submitted_at = now(), score = $2, passed = $3, expired = $4, answers = $5
			 where id = $1 returning submitted_at`,
			[attemptId, score, passed, expired, JSON.stringify(answers)],
		);

		if (passed) {
			await emitEvent(
				client,
				"exam.passed",
				{ attemptId, examId: attempt.exam_id, courseId, userId, score },
				`exam.passed:${attemptId}`,
			);
			await completeCourseIfDone(client, courseId, userId);
		}

		return {
			ok: true as const,
			result: {
				attemptId,
				score,
				passed,
				expired,
				submittedAt: (
					saved.rows[0] as { submitted_at: Date }
				).submitted_at.toISOString(),
				review: attempt.show_answers_after
					? reviewOf(key, attempt.layout, answers)
					: null,
			},
		};
	});
}

/** A past attempt of this student; the review is included only if the exam allows it. */
export async function getAttemptResult(
	organizationId: string,
	courseId: string,
	userId: string,
	attemptId: string,
): Promise<AttemptResult | null> {
	return inTransaction(async (client) => {
		const { rows } = await client.query<{
			exam_id: string;
			layout: Layout;
			answers: Answers;
			score: number;
			passed: boolean;
			expired: boolean;
			submitted_at: Date;
			show_answers_after: boolean;
		}>(
			`select a.exam_id, a.layout, a.answers, a.score, a.passed, a.expired, a.submitted_at,
			        e.show_answers_after
			 from exams.attempt a join exams.exam e on e.id = a.exam_id
			 where a.id = $1 and a.user_id = $2 and e.course_id = $3 and e.organization_id = $4
			   and a.submitted_at is not null`,
			[attemptId, userId, courseId, organizationId],
		);
		const attempt = rows[0];
		if (!attempt) return null;
		return {
			attemptId,
			score: attempt.score,
			passed: attempt.passed,
			expired: attempt.expired,
			submittedAt: attempt.submitted_at.toISOString(),
			review: attempt.show_answers_after
				? reviewOf(
						await loadKey(client, attempt.exam_id),
						attempt.layout,
						attempt.answers,
					)
				: null,
		};
	});
}

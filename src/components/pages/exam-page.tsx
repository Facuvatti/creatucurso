import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type {
	Answers,
	AttemptResult,
	AttemptView,
	ExamListItem,
	ReviewItem,
} from "../../areas/exams/types.ts";
import {
	type ExamPageData,
	getExamAttempt,
	startExam,
	submitExam,
} from "../../server/exams.functions.ts";

type Ok = Extract<ExamPageData, { kind: "ok" }>;

/** Exams of a course, shown in the lessons of an enrolled student. */
export function ExamList({
	courseSlug,
	exams,
}: {
	courseSlug: string;
	exams: ExamListItem[];
}) {
	if (exams.length === 0) return null;
	return (
		<section>
			<h2>Exámenes</h2>
			<ul>
				{exams.map((exam) => (
					<li key={exam.id}>
						<Link
							to="/cursos/$courseSlug/examenes/$examId"
							params={{ courseSlug, examId: exam.id }}
						>
							{exam.title}
						</Link>{" "}
						<small>
							{exam.required ? "Obligatorio. " : ""}
							{exam.passed
								? "Aprobado ✓"
								: `Intentos: ${exam.attemptsUsed}${exam.maxAttempts ? ` de ${exam.maxAttempts}` : ""}`}
						</small>
					</li>
				))}
			</ul>
		</section>
	);
}

function secondsLeft(deadline: string | null): number | null {
	return deadline === null
		? null
		: Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000));
}

function clock(total: number): string {
	const minutes = Math.floor(total / 60);
	return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function ExamPage({ data }: { data: Ok }) {
	const { course, exam } = data;
	const router = useRouter();
	const [attempt, setAttempt] = useState<AttemptView | null>(exam.open);
	const [answers, setAnswers] = useState<Answers>({});
	const [result, setResult] = useState<AttemptResult | null>(null);
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();
	const [left, setLeft] = useState<number | null>(
		secondsLeft(exam.open?.deadline ?? null),
	);
	const submitting = useRef(false);

	async function submit(view: AttemptView) {
		if (submitting.current) return;
		submitting.current = true;
		setPending(true);
		const response = await submitExam({
			data: { courseSlug: course.slug, attemptId: view.attemptId, answers },
		});
		if (response.ok) {
			setResult(response.result);
			setAttempt(null);
			setMessage(undefined);
			await router.invalidate();
		} else {
			setMessage(response.message);
		}
		submitting.current = false;
		setPending(false);
	}

	// Countdown for display; the server enforces the limit from started_at.
	useEffect(() => {
		if (!attempt || attempt.deadline === null) return;
		const view = attempt;
		const timer = setInterval(() => {
			const remaining = secondsLeft(view.deadline);
			setLeft(remaining);
			if (remaining === 0) {
				clearInterval(timer);
				submit(view);
			}
		}, 1000);
		return () => clearInterval(timer);
		// biome-ignore lint/correctness/useExhaustiveDependencies: submit reads the latest answers on each tick
	}, [attempt, answers]);

	const usedUp =
		exam.maxAttempts !== null && exam.attempts.length >= exam.maxAttempts;

	return (
		<main data-page="exam">
			<p>
				<Link to="/cursos/$courseSlug" params={{ courseSlug: course.slug }}>
					{course.name}
				</Link>
			</p>
			<h1>{exam.title}</h1>
			{message && <output>{message}</output>}

			{attempt ? (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						submit(attempt);
					}}
				>
					{left !== null && (
						<p>
							Tiempo restante: <strong>{clock(left)}</strong>
						</p>
					)}
					<ol>
						{attempt.questions.map((q) => (
							<li key={q.id}>
								<p>
									{q.prompt}{" "}
									<small>
										({q.points} {q.points === 1 ? "punto" : "puntos"})
									</small>
								</p>
								{(q.kind === "single" ||
									q.kind === "truefalse" ||
									q.kind === "multiple") &&
									q.options.map((o) => {
										const chosen = (answers[q.id] as string[] | undefined) ?? [];
										const multiple = q.kind === "multiple";
										return (
											<label key={o.id}>
												<input
													type={multiple ? "checkbox" : "radio"}
													name={q.id}
													checked={chosen.includes(o.id)}
													onChange={(event) =>
														setAnswers({
															...answers,
															[q.id]: multiple
																? event.target.checked
																	? [...chosen, o.id]
																	: chosen.filter((id) => id !== o.id)
																: [o.id],
														})
													}
												/>{" "}
												{o.text}
												<br />
											</label>
										);
									})}
								{(q.kind === "short_text" || q.kind === "numeric") && (
									<input
										value={(answers[q.id] as string | undefined) ?? ""}
										inputMode={q.kind === "numeric" ? "decimal" : "text"}
										maxLength={500}
										onChange={(event) =>
											setAnswers({ ...answers, [q.id]: event.target.value })
										}
									/>
								)}
							</li>
						))}
					</ol>
					<button type="submit" disabled={pending}>
						Entregar examen
					</button>
				</form>
			) : result ? (
				<section>
					<ResultView result={result} passingScore={exam.passingScore} />
					<button type="button" onClick={() => setResult(null)}>
						Volver al examen
					</button>
				</section>
			) : (
				<section>
					<p>
						Para aprobar necesitás {exam.passingScore} %.
						{exam.timeLimitSeconds
							? ` Tenés ${Math.round(exam.timeLimitSeconds / 60)} minutos desde que empezás.`
							: ""}
						{exam.maxAttempts ? ` Intentos permitidos: ${exam.maxAttempts}.` : ""}
						{exam.required ? " Es obligatorio para completar el curso." : ""}
					</p>
					{exam.passed ? (
						<p>
							<strong>Aprobaste este examen ✓</strong>
						</p>
					) : usedUp ? (
						<p>Ya usaste todos los intentos.</p>
					) : (
						<button
							type="button"
							disabled={pending}
							onClick={async () => {
								setPending(true);
								const response = await startExam({
									data: { courseSlug: course.slug, examId: exam.id },
								});
								if (response.ok) {
									setAnswers({});
									setAttempt(response.view);
									setLeft(secondsLeft(response.view.deadline));
									setMessage(undefined);
								} else {
									setMessage(response.message);
								}
								setPending(false);
							}}
						>
							{exam.attempts.length > 0 ? "Intentar de nuevo" : "Empezar"}
						</button>
					)}

					{exam.attempts.length > 0 && (
						<>
							<h2>Tus intentos</h2>
							<ul>
								{exam.attempts.map((a) => (
									<li key={a.attemptId}>
										{new Date(a.submittedAt).toLocaleString("es-AR")}:{" "}
										{a.score} %{" "}
										{a.expired
											? "(fuera de tiempo)"
											: a.passed
												? "(aprobado)"
												: "(desaprobado)"}{" "}
										<button
											type="button"
											onClick={async () => {
												const found = await getExamAttempt({
													data: { courseSlug: course.slug, attemptId: a.attemptId },
												});
												if (found) setResult(found);
											}}
										>
											Ver
										</button>
									</li>
								))}
							</ul>
						</>
					)}
				</section>
			)}
		</main>
	);
}

function ResultView({
	result,
	passingScore,
}: {
	result: AttemptResult;
	passingScore: number;
}) {
	return (
		<>
			<h2>
				{result.expired
					? "Se terminó el tiempo"
					: result.passed
						? "¡Aprobaste!"
						: "No aprobaste"}
			</h2>
			<p>
				Puntaje: <strong>{result.score} %</strong> (se aprueba con{" "}
				{passingScore} %).
			</p>
			{result.review && (
				<ol>
					{result.review.map((item) => (
						<ReviewRow key={item.questionId} item={item} />
					))}
				</ol>
			)}
		</>
	);
}

function ReviewRow({ item }: { item: ReviewItem }) {
	const given = item.given;
	const choice = item.kind === "single" || item.kind === "multiple" || item.kind === "truefalse";
	return (
		<li>
			<p>
				{item.correct ? "✓" : "✗"} {item.prompt}
			</p>
			{choice ? (
				<ul>
					{item.options.map((o) => (
						<li key={o.id}>
							{o.text}
							{o.correct ? " (correcta)" : ""}
							{Array.isArray(given) && given.includes(o.id) ? " ← tu respuesta" : ""}
						</li>
					))}
				</ul>
			) : (
				<p>
					Tu respuesta: {typeof given === "string" && given !== "" ? given : "(vacía)"}.
					Respuestas aceptadas: {item.accepted.join(", ")}.
				</p>
			)}
		</li>
	);
}

import { useState } from "react";
import type {
	ExamResultRow,
	QuestionKind,
	StaffExam,
} from "../../areas/exams/types.ts";
import {
	deleteExam,
	deleteExamQuestion,
	getExamResults,
	saveExamQuestion,
	saveExamSettings,
	setExamPublished,
} from "../../server/exams.functions.ts";

type Result = { ok: true } | { ok: false; message: string };
type Question = StaffExam["questions"][number];

const KIND_LABELS: Record<QuestionKind, string> = {
	single: "Opción única",
	multiple: "Opción múltiple",
	truefalse: "Verdadero o falso",
	short_text: "Texto corto",
	numeric: "Numérica",
};

function field(form: HTMLFormElement, name: string): string {
	return String(new FormData(form).get(name) ?? "");
}

function checked(form: HTMLFormElement, name: string): boolean {
	return new FormData(form).get(name) === "on";
}

/** Runs a server action, shows its message and tells the page to reload. */
function useRun(onChanged: () => void) {
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();
	async function run(action: () => Promise<Result>, success?: string) {
		setPending(true);
		const result = await action();
		setMessage(result.ok ? success : result.message);
		if (result.ok) onChanged();
		setPending(false);
		return result.ok;
	}
	return { run, pending, message };
}

/** Exams of a course: settings, questions, publish and results. Owner and admins only. */
export function ExamEditor({
	courseId,
	modules,
	exams,
	onChanged,
}: {
	courseId: string;
	modules: { id: string; title: string }[];
	exams: StaffExam[];
	onChanged: () => void;
}) {
	return (
		<section>
			<h2>Exámenes</h2>
			<p>
				Los alumnos inscriptos los rinden desde las clases y se corrigen al
				instante. Un examen obligatorio publicado hay que aprobarlo para
				completar el curso.
			</p>
			{exams.length === 0 && <p>Todavía no hay exámenes.</p>}
			{exams.map((exam) => (
				<ExamCard
					key={exam.id}
					courseId={courseId}
					modules={modules}
					exam={exam}
					onChanged={onChanged}
				/>
			))}
			<h3>Nuevo examen</h3>
			<SettingsForm
				courseId={courseId}
				modules={modules}
				exam={null}
				onChanged={onChanged}
			/>
		</section>
	);
}

function SettingsForm({
	courseId,
	modules,
	exam,
	onChanged,
}: {
	courseId: string;
	modules: { id: string; title: string }[];
	exam: StaffExam | null;
	onChanged: () => void;
}) {
	const { run, pending, message } = useRun(onChanged);
	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();
				const form = event.currentTarget;
				const maxAttempts = field(form, "maxAttempts").trim();
				const minutes = field(form, "timeLimitMinutes").trim();
				const ok = await run(
					() =>
						saveExamSettings({
							data: {
								courseId,
								examId: exam?.id ?? null,
								title: field(form, "title"),
								moduleId: field(form, "moduleId") || null,
								passingScore: Number(field(form, "passingScore")),
								maxAttempts: maxAttempts === "" ? null : Number(maxAttempts),
								timeLimitMinutes: minutes === "" ? null : Number(minutes),
								shuffleQuestions: checked(form, "shuffleQuestions"),
								shuffleOptions: checked(form, "shuffleOptions"),
								showAnswersAfter: checked(form, "showAnswersAfter"),
								required: checked(form, "required"),
							},
						}),
					"Examen guardado.",
				);
				if (ok && !exam) form.reset();
			}}
		>
			<label>
				Título
				<input name="title" defaultValue={exam?.title ?? ""} required />
			</label>
			<label>
				Módulo (opcional)
				<select name="moduleId" defaultValue={exam?.moduleId ?? ""}>
					<option value="">Todo el curso</option>
					{modules.map((m) => (
						<option key={m.id} value={m.id}>
							{m.title}
						</option>
					))}
				</select>
			</label>
			<label>
				Puntaje para aprobar (0 a 100 %)
				<input
					name="passingScore"
					type="number"
					min={0}
					max={100}
					defaultValue={exam?.passingScore ?? 60}
					required
				/>
			</label>
			<label>
				Intentos máximos (vacío = sin límite)
				<input
					name="maxAttempts"
					type="number"
					min={1}
					max={100}
					defaultValue={exam?.maxAttempts ?? ""}
				/>
			</label>
			<label>
				Tiempo límite en minutos (vacío = sin límite)
				<input
					name="timeLimitMinutes"
					type="number"
					min={1}
					max={600}
					defaultValue={
						exam?.timeLimitSeconds ? exam.timeLimitSeconds / 60 : ""
					}
				/>
			</label>
			<label>
				<input
					name="shuffleQuestions"
					type="checkbox"
					defaultChecked={exam?.shuffleQuestions ?? false}
				/>{" "}
				Mezclar las preguntas
			</label>
			<label>
				<input
					name="shuffleOptions"
					type="checkbox"
					defaultChecked={exam?.shuffleOptions ?? false}
				/>{" "}
				Mezclar las opciones
			</label>
			<label>
				<input
					name="showAnswersAfter"
					type="checkbox"
					defaultChecked={exam?.showAnswersAfter ?? false}
				/>{" "}
				Mostrar las respuestas correctas después de entregar
			</label>
			<label>
				<input
					name="required"
					type="checkbox"
					defaultChecked={exam?.required ?? false}
				/>{" "}
				Obligatorio para completar el curso
			</label>
			<button type="submit" disabled={pending}>
				{exam ? "Guardar ajustes" : "Crear examen"}
			</button>
			{message && <output> {message}</output>}
		</form>
	);
}

function ExamCard({
	courseId,
	modules,
	exam,
	onChanged,
}: {
	courseId: string;
	modules: { id: string; title: string }[];
	exam: StaffExam;
	onChanged: () => void;
}) {
	const { run, pending, message } = useRun(onChanged);
	const [results, setResults] = useState<ExamResultRow[] | null>(null);
	const [editing, setEditing] = useState<string | "new" | null>(null);
	const frozen = exam.attemptCount > 0;

	return (
		<article>
			<h3>
				{exam.title}{" "}
				<small>
					({exam.published ? "publicado" : "borrador"}
					{exam.required ? ", obligatorio" : ""})
				</small>
			</h3>
			<p>
				<button
					type="button"
					disabled={pending}
					onClick={() =>
						run(
							() =>
								setExamPublished({
									data: {
										courseId,
										examId: exam.id,
										published: !exam.published,
									},
								}),
							exam.published ? "Examen despublicado." : "Examen publicado.",
						)
					}
				>
					{exam.published ? "Despublicar" : "Publicar"}
				</button>{" "}
				<button
					type="button"
					disabled={pending}
					onClick={() => {
						if (
							!window.confirm(
								`¿Borrar el examen "${exam.title}" y sus intentos?`,
							)
						)
							return;
						run(
							() => deleteExam({ data: { courseId, examId: exam.id } }),
							"Examen borrado.",
						);
					}}
				>
					Borrar examen
				</button>{" "}
				<button
					type="button"
					onClick={async () =>
						setResults(
							results
								? null
								: await getExamResults({ data: { courseId, examId: exam.id } }),
						)
					}
				>
					{results
						? "Ocultar resultados"
						: `Ver resultados (${exam.attemptCount})`}
				</button>
			</p>
			{message && <output>{message}</output>}

			{results && (
				<table>
					<thead>
						<tr>
							<th>Alumno</th>
							<th>Entregado</th>
							<th>Puntaje</th>
							<th>Resultado</th>
						</tr>
					</thead>
					<tbody>
						{results.length === 0 && (
							<tr>
								<td colSpan={4}>Todavía no hay intentos entregados.</td>
							</tr>
						)}
						{results.map((r) => (
							<tr key={r.attemptId}>
								<td>
									{r.studentName} <small>({r.studentEmail})</small>
								</td>
								<td>{new Date(r.submittedAt).toLocaleString("es-AR")}</td>
								<td>{r.score} %</td>
								<td>
									{r.expired
										? "Fuera de tiempo"
										: r.passed
											? "Aprobado"
											: "Desaprobado"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<details>
				<summary>Ajustes</summary>
				<SettingsForm
					courseId={courseId}
					modules={modules}
					exam={exam}
					onChanged={onChanged}
				/>
			</details>

			<h4>Preguntas</h4>
			{frozen && (
				<p>
					<small>
						Este examen ya tiene intentos: las preguntas no se pueden cambiar.
					</small>
				</p>
			)}
			{exam.questions.length === 0 && <p>Todavía no hay preguntas.</p>}
			<ol>
				{exam.questions.map((q) => (
					<li key={q.id}>
						{editing === q.id ? (
							<QuestionForm
								courseId={courseId}
								examId={exam.id}
								question={q}
								onDone={() => setEditing(null)}
								onChanged={onChanged}
							/>
						) : (
							<>
								<strong>{q.prompt}</strong>{" "}
								<small>
									({KIND_LABELS[q.kind]}, {q.points}{" "}
									{q.points === 1 ? "punto" : "puntos"})
								</small>
								<ul>
									{q.options.map((o) => (
										<li key={o.id}>
											{o.correct ? "✓ " : ""}
											{o.text}
										</li>
									))}
									{q.accepted.map((a) => (
										<li key={a.value}>
											✓ {a.value}
											{a.tolerance ? ` (± ${a.tolerance})` : ""}
										</li>
									))}
								</ul>
								{!frozen && (
									<>
										<button type="button" onClick={() => setEditing(q.id)}>
											Editar
										</button>{" "}
										<button
											type="button"
											disabled={pending}
											onClick={() =>
												run(
													() =>
														deleteExamQuestion({
															data: {
																courseId,
																examId: exam.id,
																questionId: q.id,
															},
														}),
													"Pregunta borrada.",
												)
											}
										>
											Borrar
										</button>
									</>
								)}
							</>
						)}
					</li>
				))}
			</ol>
			{!frozen &&
				(editing === "new" ? (
					<QuestionForm
						courseId={courseId}
						examId={exam.id}
						question={null}
						onDone={() => setEditing(null)}
						onChanged={onChanged}
					/>
				) : (
					<button type="button" onClick={() => setEditing("new")}>
						Agregar pregunta
					</button>
				))}
		</article>
	);
}

function QuestionForm({
	courseId,
	examId,
	question,
	onDone,
	onChanged,
}: {
	courseId: string;
	examId: string;
	question: Question | null;
	onDone: () => void;
	onChanged: () => void;
}) {
	const { run, pending, message } = useRun(onChanged);
	const [kind, setKind] = useState<QuestionKind>(question?.kind ?? "single");
	const [prompt, setPrompt] = useState(question?.prompt ?? "");
	const [points, setPoints] = useState(question?.points ?? 1);
	const [options, setOptions] = useState(
		question && question.options.length > 0 && question.kind !== "truefalse"
			? question.options.map((o) => ({ text: o.text, correct: o.correct }))
			: [
					{ text: "", correct: true },
					{ text: "", correct: false },
				],
	);
	const [trueIsCorrect, setTrueIsCorrect] = useState(
		question?.kind === "truefalse"
			? (question.options[0]?.correct ?? true)
			: true,
	);
	const [accepted, setAccepted] = useState(
		question && question.accepted.length > 0
			? question.accepted.map((a) => ({
					value: a.value,
					tolerance: a.tolerance ? String(a.tolerance) : "",
				}))
			: [{ value: "", tolerance: "" }],
	);

	const isChoice = kind === "single" || kind === "multiple";

	function setCorrect(index: number, correct: boolean) {
		setOptions(
			options.map((o, i) =>
				kind === "single"
					? { ...o, correct: i === index }
					: i === index
						? { ...o, correct }
						: o,
			),
		);
	}

	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();
				const ok = await run(
					() =>
						saveExamQuestion({
							data: {
								courseId,
								examId,
								questionId: question?.id ?? null,
								kind,
								prompt,
								points,
								options: isChoice
									? options
									: kind === "truefalse"
										? [
												{ text: "Verdadero", correct: trueIsCorrect },
												{ text: "Falso", correct: !trueIsCorrect },
											]
										: [],
								accepted:
									kind === "short_text" || kind === "numeric"
										? accepted.map((a) => ({
												value: a.value,
												tolerance:
													kind === "numeric" && a.tolerance.trim() !== ""
														? Number(a.tolerance.replace(",", "."))
														: null,
											}))
										: [],
							},
						}),
					"Pregunta guardada.",
				);
				if (ok) onDone();
			}}
		>
			<label>
				Tipo
				<select
					value={kind}
					onChange={(event) => setKind(event.target.value as QuestionKind)}
				>
					{Object.entries(KIND_LABELS).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>
			</label>
			<label>
				Enunciado
				<textarea
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					rows={2}
					required
				/>
			</label>
			<label>
				Puntos
				<input
					type="number"
					min={1}
					max={100}
					value={points}
					onChange={(event) => setPoints(Number(event.target.value))}
					required
				/>
			</label>

			{isChoice && (
				<>
					{options.map((o, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: options have no id until saved
						<p key={i}>
							<input
								type={kind === "single" ? "radio" : "checkbox"}
								name="correct"
								aria-label="Es correcta"
								checked={o.correct}
								onChange={(event) => setCorrect(i, event.target.checked)}
							/>{" "}
							<input
								value={o.text}
								placeholder={`Opción ${i + 1}`}
								onChange={(event) =>
									setOptions(
										options.map((x, j) =>
											j === i ? { ...x, text: event.target.value } : x,
										),
									)
								}
								required
							/>{" "}
							<button
								type="button"
								disabled={options.length <= 2}
								onClick={() => setOptions(options.filter((_, j) => j !== i))}
							>
								Quitar
							</button>
						</p>
					))}
					<button
						type="button"
						disabled={options.length >= 10}
						onClick={() =>
							setOptions([...options, { text: "", correct: false }])
						}
					>
						Agregar opción
					</button>
				</>
			)}

			{kind === "truefalse" && (
				<fieldset>
					<legend>Respuesta correcta</legend>
					<label>
						<input
							type="radio"
							name="tf"
							checked={trueIsCorrect}
							onChange={() => setTrueIsCorrect(true)}
						/>{" "}
						Verdadero
					</label>
					<label>
						<input
							type="radio"
							name="tf"
							checked={!trueIsCorrect}
							onChange={() => setTrueIsCorrect(false)}
						/>{" "}
						Falso
					</label>
				</fieldset>
			)}

			{(kind === "short_text" || kind === "numeric") && (
				<>
					<p>
						{kind === "short_text"
							? "Respuestas aceptadas (no distingue mayúsculas ni espacios de más)."
							: "Respuestas aceptadas con su tolerancia (± valor)."}
					</p>
					{accepted.map((a, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: answers have no id until saved
						<p key={i}>
							<input
								value={a.value}
								placeholder="Respuesta"
								onChange={(event) =>
									setAccepted(
										accepted.map((x, j) =>
											j === i ? { ...x, value: event.target.value } : x,
										),
									)
								}
								required
							/>{" "}
							{kind === "numeric" && (
								<input
									value={a.tolerance}
									inputMode="decimal"
									placeholder="Tolerancia (± opcional)"
									onChange={(event) =>
										setAccepted(
											accepted.map((x, j) =>
												j === i ? { ...x, tolerance: event.target.value } : x,
											),
										)
									}
								/>
							)}{" "}
							<button
								type="button"
								disabled={accepted.length <= 1}
								onClick={() => setAccepted(accepted.filter((_, j) => j !== i))}
							>
								Quitar
							</button>
						</p>
					))}
					<button
						type="button"
						onClick={() =>
							setAccepted([...accepted, { value: "", tolerance: "" }])
						}
					>
						Agregar respuesta
					</button>
				</>
			)}

			<p>
				<button type="submit" disabled={pending}>
					Guardar pregunta
				</button>{" "}
				<button type="button" onClick={onDone}>
					Cancelar
				</button>
			</p>
			{message && <output>{message}</output>}
		</form>
	);
}

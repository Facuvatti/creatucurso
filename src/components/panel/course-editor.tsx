import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { CourseOutline } from "../../areas/catalog/types.ts";
import {
	type ActionResult,
	deleteCourseItem,
	exportCourseJson,
	moveCourseItem,
	renameCourseSlug,
	setCourseStatus,
	updateCourseDetails,
	updateLesson,
	updateModule,
} from "../../server/catalog.functions.ts";

function field(form: HTMLFormElement, name: string): string {
	return String(new FormData(form).get(name) ?? "");
}

/** Runs a server action, shows its message and refreshes the page data. */
function useAction() {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();
	async function run(action: () => Promise<ActionResult>, success?: string) {
		setPending(true);
		const result = await action();
		setMessage(result.ok ? success : result.message);
		if (result.ok) await router.invalidate();
		setPending(false);
	}
	return { run, pending, message };
}

/** Publish / unpublish; publishing needs a second, explicit click. */
export function PublishControl({ course }: { course: CourseOutline }) {
	const { run, pending, message } = useAction();
	const [confirming, setConfirming] = useState(false);
	const published = course.status === "published";

	if (published) {
		return (
			<>
				<button
					type="button"
					disabled={pending}
					onClick={() =>
						run(
							() =>
								setCourseStatus({
									data: { courseId: course.id, status: "draft" },
								}),
							"El curso volvió a borrador.",
						)
					}
				>
					Pasar a borrador
				</button>
				{message && <output> {message}</output>}
			</>
		);
	}
	if (!confirming) {
		return (
			<>
				<button type="button" onClick={() => setConfirming(true)}>
					Publicar
				</button>
				{message && <output> {message}</output>}
			</>
		);
	}
	return (
		<>
			<span>Los alumnos van a ver el curso en tu sitio. </span>
			<button
				type="button"
				disabled={pending}
				onClick={async () => {
					await run(
						() =>
							setCourseStatus({
								data: { courseId: course.id, status: "published" },
							}),
						"Curso publicado.",
					);
					setConfirming(false);
				}}
			>
				Sí, publicar ahora
			</button>{" "}
			<button type="button" onClick={() => setConfirming(false)}>
				Cancelar
			</button>
			{message && <output> {message}</output>}
		</>
	);
}

/** Name, descriptions and address (slug) of the course. */
export function CourseDetailsForm({ course }: { course: CourseOutline }) {
	const { run, pending, message } = useAction();
	return (
		<section>
			<h2>Datos del curso</h2>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const form = event.currentTarget;
					run(
						() =>
							updateCourseDetails({
								data: {
									courseId: course.id,
									name: field(form, "name"),
									shortDescription: field(form, "shortDescription"),
									longDescription: field(form, "longDescription"),
								},
							}),
						"Datos guardados.",
					);
				}}
			>
				<label>
					Nombre
					<input
						name="name"
						defaultValue={course.name}
						required
						minLength={2}
					/>
				</label>
				<label>
					Descripción corta
					<input
						name="shortDescription"
						defaultValue={course.shortDescription ?? ""}
						maxLength={300}
					/>
				</label>
				<label>
					Descripción completa
					<textarea
						name="longDescription"
						defaultValue={course.longDescription ?? ""}
						rows={6}
					/>
				</label>
				<button type="submit" disabled={pending}>
					Guardar datos
				</button>
			</form>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					const form = event.currentTarget;
					run(
						() =>
							renameCourseSlug({
								data: { courseId: course.id, slug: field(form, "slug") },
							}),
						"Dirección cambiada. La anterior sigue funcionando.",
					);
				}}
			>
				<label>
					Dirección del curso (/cursos/…)
					<input
						name="slug"
						defaultValue={course.slug}
						required
						pattern="[a-z0-9]+(-[a-z0-9]+)*"
						maxLength={80}
					/>
				</label>
				<button type="submit" disabled={pending}>
					Cambiar dirección
				</button>
			</form>
			{message && <output>{message}</output>}
		</section>
	);
}

/** Rename, reorder and delete modules and lessons. Adding stays in the content section. */
export function StructureEditor({ course }: { course: CourseOutline }) {
	const { run, pending, message } = useAction();
	const base = { courseId: course.id };

	const move = (kind: "module" | "lesson", id: string, dir: "up" | "down") =>
		run(() => moveCourseItem({ data: { ...base, kind, id, direction: dir } }));

	const remove = (kind: "module" | "lesson", id: string, what: string) => {
		if (!window.confirm(`¿Borrar ${what}? No se puede deshacer.`)) return;
		run(() => deleteCourseItem({ data: { ...base, kind, id } }), "Borrado.");
	};

	function Arrows(props: {
		kind: "module" | "lesson";
		id: string;
		first: boolean;
		last: boolean;
	}) {
		return (
			<>
				<button
					type="button"
					aria-label="Subir"
					disabled={pending || props.first}
					onClick={() => move(props.kind, props.id, "up")}
				>
					↑
				</button>
				<button
					type="button"
					aria-label="Bajar"
					disabled={pending || props.last}
					onClick={() => move(props.kind, props.id, "down")}
				>
					↓
				</button>
			</>
		);
	}

	if (course.modules.length === 0) return null;
	return (
		<section>
			<h2>Editar estructura</h2>
			{message && <output>{message}</output>}
			<ol>
				{course.modules.map((module, m) => (
					<li key={module.id}>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = event.currentTarget;
								run(
									() =>
										updateModule({
											data: {
												...base,
												moduleId: module.id,
												title: field(form, "title"),
												description: field(form, "description"),
											},
										}),
									"Módulo guardado.",
								);
							}}
						>
							<input name="title" defaultValue={module.title} required />
							<input
								name="description"
								defaultValue={module.description ?? ""}
								placeholder="Descripción (opcional)"
							/>
							<button type="submit" disabled={pending}>
								Guardar módulo
							</button>
							<Arrows
								kind="module"
								id={module.id}
								first={m === 0}
								last={m === course.modules.length - 1}
							/>
							<button
								type="button"
								disabled={pending}
								onClick={() =>
									remove(
										"module",
										module.id,
										`el módulo "${module.title}" y sus clases`,
									)
								}
							>
								Borrar módulo
							</button>
						</form>
						<ul>
							{module.lessons.map((lesson, l) => (
								<li key={lesson.id}>
									<form
										onSubmit={(event) => {
											event.preventDefault();
											const form = event.currentTarget;
											run(
												() =>
													updateLesson({
														data: {
															...base,
															lessonId: lesson.id,
															title: field(form, "title"),
															description: field(form, "description"),
														},
													}),
												"Clase guardada.",
											);
										}}
									>
										<input name="title" defaultValue={lesson.title} required />
										<textarea
											name="description"
											defaultValue={lesson.description ?? ""}
											rows={2}
											placeholder="Descripción o texto de la clase"
										/>
										<button type="submit" disabled={pending}>
											Guardar clase
										</button>
										<Arrows
											kind="lesson"
											id={lesson.id}
											first={l === 0}
											last={l === module.lessons.length - 1}
										/>
										<button
											type="button"
											disabled={pending}
											onClick={() =>
												remove(
													"lesson",
													lesson.id,
													`la clase "${lesson.title}"`,
												)
											}
										>
											Borrar clase
										</button>
									</form>
								</li>
							))}
						</ul>
					</li>
				))}
			</ol>
		</section>
	);
}

/** Downloads the course as importable JSON. */
export function ExportButton({ course }: { course: CourseOutline }) {
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			disabled={busy}
			onClick={async () => {
				setBusy(true);
				const file = await exportCourseJson({ data: { courseId: course.id } });
				if (file) {
					const url = URL.createObjectURL(
						new Blob([file.json], { type: "application/json" }),
					);
					const link = document.createElement("a");
					link.href = url;
					link.download = file.filename;
					link.click();
					URL.revokeObjectURL(url);
				}
				setBusy(false);
			}}
		>
			Exportar como JSON
		</button>
	);
}

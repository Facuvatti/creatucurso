import { Link } from "@tanstack/react-router";
import type { CourseOutline } from "../../modules/catalog/domain/types.ts";

type Props = {
	course: CourseOutline;
	message?: string | undefined;
	pending: boolean;
	onStatus: (status: "draft" | "published") => void;
	onAddModule: (title: string) => void;
	onAddLesson: (values: {
		moduleId: string;
		title: string;
		description: string;
	}) => void;
	onEnroll: (email: string) => void;
};

function text(form: HTMLFormElement, name: string): string {
	return String(new FormData(form).get(name) ?? "");
}

export function PanelCoursePage({
	course,
	message,
	pending,
	onStatus,
	onAddModule,
	onAddLesson,
	onEnroll,
}: Props) {
	const published = course.status === "published";

	return (
		<main data-page="panel-course">
			<p>
				<Link to="/panel">← Panel</Link>
			</p>
			<h1>{course.name}</h1>
			<p>
				Estado: <strong>{published ? "publicado" : "borrador"}</strong>{" "}
				<button
					type="button"
					disabled={pending}
					onClick={() => onStatus(published ? "draft" : "published")}
				>
					{published ? "Pasar a borrador" : "Publicar"}
				</button>{" "}
				<Link to="/cursos/$courseSlug" params={{ courseSlug: course.slug }}>
					Ver como alumno
				</Link>
			</p>
			{message && <output>{message}</output>}

			<section>
				<h2>Contenido</h2>
				{course.modules.length === 0 && <p>Todavía no hay módulos.</p>}
				<ol>
					{course.modules.map((module) => (
						<li key={module.id}>
							<h3>{module.title}</h3>
							<ul>
								{module.lessons.map((lesson) => (
									<li key={lesson.id}>
										{lesson.title}{" "}
										<small>
											({lesson.videos.length} video
											{lesson.videos.length === 1 ? "" : "s"})
										</small>
									</li>
								))}
							</ul>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									const form = event.currentTarget;
									onAddLesson({
										moduleId: module.id,
										title: text(form, "title"),
										description: text(form, "description"),
									});
									form.reset();
								}}
							>
								<input name="title" placeholder="Título de la clase" required />
								<input
									name="description"
									placeholder="Descripción (opcional)"
								/>
								<button type="submit" disabled={pending}>
									Agregar clase
								</button>
							</form>
						</li>
					))}
				</ol>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = event.currentTarget;
						onAddModule(text(form, "title"));
						form.reset();
					}}
				>
					<input name="title" placeholder="Título del módulo" required />
					<button type="submit" disabled={pending}>
						Agregar módulo
					</button>
				</form>
			</section>

			<section>
				<h2>Inscribir a una persona</h2>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = event.currentTarget;
						onEnroll(text(form, "email"));
						form.reset();
					}}
				>
					<input
						name="email"
						type="email"
						placeholder="Email de la persona"
						required
					/>
					<button type="submit" disabled={pending}>
						Inscribir
					</button>
				</form>
			</section>
		</main>
	);
}

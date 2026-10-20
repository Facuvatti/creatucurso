import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { UploadSlot } from "../../areas/catalog/course-from-import.ts";
import type { ImportIssue } from "../../areas/catalog/course-import.ts";
import type { CourseSummary } from "../../areas/catalog/types.ts";
import { slugify } from "../../shared/text/slugify.ts";

export type ImportOutcome =
	| { kind: "idle" }
	| { kind: "errors"; errors: ImportIssue[] }
	| { kind: "done"; courseId: string; uploadSlots: UploadSlot[] };

type Props = {
	courses: CourseSummary[];
	canManagePayments: boolean;
	createError?: string | undefined;
	importOutcome: ImportOutcome;
	pending: boolean;
	onCreate: (values: {
		name: string;
		slug: string;
		shortDescription: string;
	}) => void;
	onImport: (json: string) => void;
};

const KIND_LABEL: Record<UploadSlot["kind"], string> = {
	cover: "Portada",
	promo: "Video de presentación",
	video: "Video",
	note: "Apunte",
};

export function PanelPage({
	courses,
	canManagePayments,
	createError,
	importOutcome,
	pending,
	onCreate,
	onImport,
}: Props) {
	const [name, setName] = useState("");
	const [customSlug, setCustomSlug] = useState<string | null>(null);
	const [shortDescription, setShortDescription] = useState("");
	const slug = customSlug ?? slugify(name);

	return (
		<main data-page="panel">
			<p>
				<Link to="/">Ver mi sitio</Link>
			</p>
			<h1>Panel de la academia</h1>
			{canManagePayments && (
				<p>
					<Link to="/panel/pagos">Cobros</Link>
				</p>
			)}

			<section>
				<h2>Mis cursos</h2>
				{courses.length === 0 ? (
					<p>Todavía no creaste ningún curso.</p>
				) : (
					<ul>
						{courses.map((course) => (
							<li key={course.id}>
								<Link
									to="/panel/cursos/$courseId"
									params={{ courseId: course.id }}
								>
									{course.name}
								</Link>{" "}
								<small>
									{course.status === "published" ? "publicado" : "borrador"}
								</small>
							</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h2>Crear un curso</h2>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						onCreate({ name, slug, shortDescription });
					}}
				>
					<label>
						Nombre
						<input
							required
							minLength={2}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<label>
						Dirección
						<input
							required
							value={slug}
							onChange={(event) => setCustomSlug(event.target.value)}
						/>
					</label>
					<label>
						Descripción corta
						<input
							maxLength={300}
							value={shortDescription}
							onChange={(event) => setShortDescription(event.target.value)}
						/>
					</label>
					{createError && <p role="alert">{createError}</p>}
					<button type="submit" disabled={pending}>
						Crear curso
					</button>
				</form>
			</section>

			<section>
				<h2>Importar un curso desde un archivo JSON</h2>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const input = event.currentTarget.elements.namedItem(
							"file",
						) as HTMLInputElement;
						const file = input.files?.[0];
						if (file) file.text().then(onImport);
					}}
				>
					<label>
						Archivo del curso
						<input
							name="file"
							type="file"
							accept="application/json,.json"
							required
						/>
					</label>
					<button type="submit" disabled={pending}>
						Importar
					</button>
				</form>

				{importOutcome.kind === "errors" && (
					<div role="alert" data-import="errors">
						<p>No pudimos importar el curso:</p>
						<ul>
							{importOutcome.errors.map((error) => (
								<li key={`${error.path}-${error.message}`}>
									<code>{error.path}</code>: {error.message}
								</li>
							))}
						</ul>
					</div>
				)}

				{importOutcome.kind === "done" && (
					<div data-import="done">
						<p>
							Curso creado como borrador.{" "}
							<Link
								to="/panel/cursos/$courseId"
								params={{ courseId: importOutcome.courseId }}
							>
								Abrirlo
							</Link>
						</p>
						{importOutcome.uploadSlots.length > 0 && (
							<>
								<p>Archivos que todavía hay que subir:</p>
								<ul>
									{importOutcome.uploadSlots.map((slot) => (
										<li key={slot.path}>
											{KIND_LABEL[slot.kind]}: {slot.name}{" "}
											<small>({slot.ref})</small>
										</li>
									))}
								</ul>
							</>
						)}
					</div>
				)}
			</section>
		</main>
	);
}

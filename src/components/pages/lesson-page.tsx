import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { LessonPageData } from "../../server/catalog.functions.ts";

type Ok = Extract<LessonPageData, { kind: "ok" }>;

type Props = {
	data: Ok;
	pending: boolean;
	onComplete: () => void;
	children?: ReactNode;
};

export function LessonPage({ data, pending, onComplete, children }: Props) {
	const { course, lesson } = data;

	return (
		<main data-page="lesson">
			<p>
				<Link to="/cursos/$courseSlug" params={{ courseSlug: course.slug }}>
					{course.name}
				</Link>
				{data.moduleTitle && <> / {data.moduleTitle}</>}
			</p>
			<h1>{lesson.title}</h1>
			{lesson.description && <p>{lesson.description}</p>}

			<section>
				<h2>Videos</h2>
				{lesson.videos.length === 0 ? (
					<p>Esta clase todavía no tiene videos.</p>
				) : (
					<ul>
						{lesson.videos.map((video) => (
							<li key={video.ref}>
								{video.name}{" "}
								<small>
									{video.status === "pending" ? "(pendiente de subir)" : ""}
								</small>
							</li>
						))}
					</ul>
				)}
			</section>

			{lesson.notes.length > 0 && (
				<section>
					<h2>Apuntes</h2>
					<ul>
						{lesson.notes.map((note) => (
							<li key={note.ref}>
								{note.name}{" "}
								<small>
									{note.status === "pending" ? "(pendiente de subir)" : ""}
								</small>
							</li>
						))}
					</ul>
				</section>
			)}

			{data.canTrackProgress && (
				<p>
					{data.completed ? (
						<strong data-status="completed">Clase completada ✓</strong>
					) : (
						<button type="button" onClick={onComplete} disabled={pending}>
							Marcar como completada
						</button>
					)}
				</p>
			)}

			<nav>
				{data.previous && (
					<Link
						to="/cursos/$courseSlug/clases/$lessonSlug"
						params={{ courseSlug: course.slug, lessonSlug: data.previous.slug }}
					>
						← {data.previous.title}
					</Link>
				)}{" "}
				{data.next && (
					<Link
						to="/cursos/$courseSlug/clases/$lessonSlug"
						params={{ courseSlug: course.slug, lessonSlug: data.next.slug }}
					>
						{data.next.title} →
					</Link>
				)}
			</nav>
			{children}
		</main>
	);
}

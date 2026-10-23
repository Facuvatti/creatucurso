import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { LessonPageData } from "../../server/catalog.functions.ts";
import { EmbedFrame } from "../lesson/embed-frame.tsx";
import { LessonVideo } from "../media/lesson-video.tsx";

type Ok = Extract<LessonPageData, { kind: "ok" }>;

type Props = {
	data: Ok;
	pending: boolean;
	onComplete: () => void;
	/** Called after an embedded app reported a result. */
	onEmbedReported: () => void;
	/** Email of the signed-in person, shown as the video watermark. */
	viewerEmail: string;
	children?: ReactNode;
};

export function LessonPage({
	data,
	pending,
	onComplete,
	onEmbedReported,
	viewerEmail,
	children,
}: Props) {
	const { course, lesson, embed } = data;

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

			{embed && (
				<section>
					<h2>Actividad</h2>
					<EmbedFrame
						embed={embed}
						courseSlug={course.slug}
						lessonSlug={lesson.slug}
						lessonId={lesson.id}
						title={lesson.title}
						onReported={onEmbedReported}
					/>
				</section>
			)}

			<section>
				<h2>Videos</h2>
				{data.video ? (
					<LessonVideo
						status={data.video.status}
						courseSlug={course.slug}
						lessonSlug={lesson.slug}
						viewerEmail={viewerEmail}
					/>
				) : lesson.videos.length === 0 ? (
					embed ? null : (
						<p>Esta clase todavía no tiene videos.</p>
					)
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

			{data.canTrackProgress && (embed ? data.completed : true) && (
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
				<div data-actions>
					{data.previous && (
						<Link
							to="/cursos/$courseSlug/clases/$lessonSlug"
							params={{
								courseSlug: course.slug,
								lessonSlug: data.previous.slug,
							}}
						>
							← {data.previous.title}
						</Link>
					)}
					{data.next && (
						<Link
							to="/cursos/$courseSlug/clases/$lessonSlug"
							params={{ courseSlug: course.slug, lessonSlug: data.next.slug }}
							data-cta="primary"
						>
							{data.next.title} →
						</Link>
					)}
				</div>
			</nav>
			{children}
		</main>
	);
}

import { Link } from "@tanstack/react-router";
import {
	allLessons,
	type CourseOutline,
} from "../../modules/catalog/domain/types.ts";
import type { CourseAccess } from "../../server/catalog.functions.ts";
import { formatMoney } from "../../shared/money.ts";

type Props = {
	course: CourseOutline;
	access: CourseAccess;
	completedLessonIds: string[];
	loginUrl: string;
	pending: boolean;
	message?: string | undefined;
	onEnrollFree: () => void;
};

function BulletList({ title, items }: { title: string; items: string[] }) {
	if (items.length === 0) return null;
	return (
		<section>
			<h2>{title}</h2>
			<ul>
				{items.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		</section>
	);
}

export function CoursePage({
	course,
	access,
	completedLessonIds,
	loginUrl,
	pending,
	message,
	onEnrollFree,
}: Props) {
	const first = allLessons(course)[0];
	const done = new Set(completedLessonIds);
	const paid = !!course.priceAmount && !!course.currency;

	return (
		<main data-page="course">
			<p>
				<Link to="/">Volver a los cursos</Link>
			</p>
			<h1>{course.name}</h1>
			{course.status === "draft" && (
				<p data-flag="draft">
					Borrador: solo lo ven quienes administran la academia.
				</p>
			)}
			{course.shortDescription && <p>{course.shortDescription}</p>}
			{course.longDescription && <p>{course.longDescription}</p>}
			<p data-price>
				{paid && course.priceAmount && course.currency
					? formatMoney(course.priceAmount, course.currency)
					: "Gratis"}
			</p>

			<BulletList title="Qué vas a aprender" items={course.learningGoals} />
			<BulletList title="Requisitos" items={course.requirements} />
			<BulletList title="Para quién es" items={course.targetStudents} />

			<section>
				<h2>Contenido</h2>
				{course.modules.length === 0 ? (
					<p>El contenido se está preparando.</p>
				) : (
					<ol>
						{course.modules.map((module) => (
							<li key={module.id}>
								<h3>{module.title}</h3>
								{module.description && <p>{module.description}</p>}
								<ul>
									{module.lessons.map((lesson) => (
										<li key={lesson.id}>
											{access.canStudy ? (
												<Link
													to="/cursos/$courseSlug/clases/$lessonSlug"
													params={{
														courseSlug: course.slug,
														lessonSlug: lesson.slug,
													}}
												>
													{lesson.title}
												</Link>
											) : (
												lesson.title
											)}
											{done.has(lesson.id) && " ✓"}
										</li>
									))}
								</ul>
							</li>
						))}
					</ol>
				)}
			</section>

			<section>
				{access.canStudy && first ? (
					<Link
						to="/cursos/$courseSlug/clases/$lessonSlug"
						params={{ courseSlug: course.slug, lessonSlug: first.slug }}
					>
						Entrar al curso
					</Link>
				) : !access.signedIn ? (
					<a href={loginUrl}>Ingresá para inscribirte</a>
				) : paid ? (
					<Link
						to="/cursos/$courseSlug/comprar"
						params={{ courseSlug: course.slug }}
					>
						Comprar el curso
					</Link>
				) : (
					<button type="button" onClick={onEnrollFree} disabled={pending}>
						Inscribirme gratis
					</button>
				)}
				{message && <output>{message}</output>}
			</section>
		</main>
	);
}

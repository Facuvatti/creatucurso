import { Link } from "@tanstack/react-router";
import type { CourseOutline } from "../../areas/catalog/types.ts";
import type { StaffExam } from "../../areas/exams/types.ts";
import type { VideoInfo } from "../../areas/media/types.ts";
import type { CertificatePanel } from "../../server/certificates.functions.ts";
import type { Tutor } from "../../server/community.functions.ts";
import { formatMoney } from "../../shared/money.ts";
import { LessonVideoUpload } from "../media/lesson-video-upload.tsx";
import { CertificateEditor } from "../panel/certificate-editor.tsx";
import {
	CourseDetailsForm,
	ExportButton,
	PublishControl,
	StructureEditor,
} from "../panel/course-editor.tsx";
import type { AcademyAddresses } from "../panel/embed-agent-prompt.ts";
import { EmbedAgentKit } from "../panel/embed-agent-kit.tsx";
import { EmbedPanel, type EmbedResultRow } from "../panel/embed-panel.tsx";
import { ExamEditor } from "../panel/exam-editor.tsx";

type Props = {
	course: CourseOutline;
	tutors: Tutor[];
	videos: Record<string, VideoInfo>;
	certificates: CertificatePanel;
	exams: StaffExam[];
	hasAppSecret: boolean;
	embedResults: EmbedResultRow[];
	agentAddresses: AcademyAddresses;
	onEmbedChanged: () => void;
	onExamsChanged: () => void;
	onCertificatesChanged: () => void;
	onVideoChanged: () => void;
	message?: string | undefined;
	pending: boolean;
	onAddModule: (title: string) => void;
	onAddLesson: (values: {
		moduleId: string;
		title: string;
		description: string;
	}) => void;
	onEnroll: (email: string) => void;
	onAddTutor: (email: string) => void;
	onRemoveTutor: (userId: string) => void;
	onSetPrice: (values: { price: number | null; currency: string }) => void;
};

function text(form: HTMLFormElement, name: string): string {
	return String(new FormData(form).get(name) ?? "");
}

export function PanelCoursePage({
	course,
	tutors,
	videos,
	certificates,
	exams,
	hasAppSecret,
	embedResults,
	agentAddresses,
	onEmbedChanged,
	onExamsChanged,
	onCertificatesChanged,
	onVideoChanged,
	message,
	pending,
	onAddModule,
	onAddLesson,
	onEnroll,
	onAddTutor,
	onRemoveTutor,
	onSetPrice,
}: Props) {
	const published = course.status === "published";

	return (
		<main data-page="panel-course">
			<p>
				<Link to="/panel">Panel</Link>
			</p>
			<h1>{course.name}</h1>
			<p>
				Estado: <strong>{published ? "publicado" : "borrador"}</strong>
			</p>
			<div data-actions>
				<PublishControl course={course} />
				<Link to="/cursos/$courseSlug" params={{ courseSlug: course.slug }}>
					Ver como alumno
				</Link>
				<ExportButton course={course} />
			</div>
			{message && <output>{message}</output>}

			<CourseDetailsForm course={course} />
			<StructureEditor course={course} />

			<section>
				<h2>Precio</h2>
				<p>
					{course.priceAmount && course.currency
						? formatMoney(course.priceAmount, course.currency)
						: "Gratis"}
				</p>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = event.currentTarget;
						const raw = text(form, "price").trim();
						onSetPrice({
							price: raw === "" ? null : Number(raw.replace(",", ".")),
							currency: text(form, "currency"),
						});
					}}
				>
					<input
						name="price"
						inputMode="decimal"
						placeholder="Precio (vacío = gratis)"
					/>
					<select name="currency" defaultValue={course.currency ?? "ARS"}>
						{["ARS", "USD", "EUR", "BRL", "MXN", "CLP", "COP", "UYU"].map(
							(c) => (
								<option key={c} value={c}>
									{c}
								</option>
							),
						)}
					</select>
					<button type="submit" disabled={pending}>
						Guardar precio
					</button>
				</form>
			</section>

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
										<LessonVideoUpload
											lessonId={lesson.id}
											video={videos[lesson.id]}
											onChanged={onVideoChanged}
										/>
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

			<ExamEditor
				courseId={course.id}
				modules={course.modules.map((m) => ({ id: m.id, title: m.title }))}
				exams={exams}
				onChanged={onExamsChanged}
			/>

			<EmbedPanel
				courseId={course.id}
				hasSecret={hasAppSecret}
				rows={embedResults}
				onChanged={onEmbedChanged}
			/>

			<EmbedAgentKit
				course={course}
				addresses={agentAddresses}
				hasAppSecret={hasAppSecret}
			/>

			<CertificateEditor
				courseId={course.id}
				panel={certificates}
				onChanged={onCertificatesChanged}
			/>

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

			<section>
				<h2>Tutores</h2>
				{tutors.length === 0 && <p>Este curso todavía no tiene tutores.</p>}
				<ul>
					{tutors.map((tutor) => (
						<li key={tutor.userId}>
							{tutor.name} <small>({tutor.email})</small>{" "}
							<button
								type="button"
								disabled={pending}
								onClick={() => onRemoveTutor(tutor.userId)}
							>
								Quitar
							</button>
						</li>
					))}
				</ul>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = event.currentTarget;
						onAddTutor(text(form, "tutorEmail"));
						form.reset();
					}}
				>
					<input
						name="tutorEmail"
						type="email"
						placeholder="Email del tutor (debe tener cuenta)"
						required
					/>
					<button type="submit" disabled={pending}>
						Agregar tutor
					</button>
				</form>
			</section>
		</main>
	);
}

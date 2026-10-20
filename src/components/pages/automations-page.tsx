import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { Automation } from "../../areas/automations/automations.ts";
import {
	renderSubject,
	renderText,
	SAMPLE_VARIABLES,
	TRIGGER_LABEL,
	TRIGGERS,
	type Trigger,
	VARIABLES,
} from "../../areas/automations/template.ts";
import {
	type AutomationsPanel,
	deleteAutomation,
	removeAttachment,
	saveAutomation,
	sendTestAutomation,
	setAutomationEnabled,
} from "../../server/automations.functions.ts";

const STATUS_LABEL = {
	pending: "pendiente",
	sent: "enviado",
	failed: "falló",
	skipped: "omitido",
} as const;

type Draft = {
	id: string | null;
	courseId: string;
	trigger: Trigger;
	name: string;
	subject: string;
	body: string;
	attachCertificate: boolean;
};

const EMPTY: Draft = {
	id: null,
	courseId: "",
	trigger: "enrollment.created",
	name: "",
	subject: "Bienvenido a {{courseTitle}}",
	body: "Hola {{studentName}},\n\nGracias por inscribirte en {{courseTitle}}. ¡Nos vemos adentro!\n\n{{academyName}}",
	attachCertificate: false,
};

function toDraft(a: Automation): Draft {
	return {
		id: a.id,
		courseId: a.courseId ?? "",
		trigger: a.trigger,
		name: a.name,
		subject: a.subject,
		body: a.body,
		attachCertificate: a.attachCertificate,
	};
}

export function AutomationsPage({
	panel,
	onChanged,
}: {
	panel: AutomationsPanel;
	onChanged: () => void;
}) {
	const [draft, setDraft] = useState<Draft | null>(null);
	const [message, setMessage] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [preview, setPreview] = useState(false);
	const current = panel.automations.find((a) => a.id === draft?.id);

	async function run(
		action: () => Promise<{ ok: true } | { ok: false; message: string }>,
		success?: string,
	) {
		setBusy(true);
		const result = await action();
		setMessage(result.ok ? success : result.message);
		setBusy(false);
		if (result.ok) onChanged();
		return result.ok;
	}

	async function save() {
		if (!draft) return;
		setBusy(true);
		const result = await saveAutomation({
			data: { ...draft, courseId: draft.courseId || null },
		});
		setBusy(false);
		if (!result.ok) return setMessage(result.message);
		setMessage("Guardado. Ahora podés adjuntar archivos.");
		setDraft({ ...draft, id: result.id ?? draft.id });
		onChanged();
	}

	async function upload(file: File) {
		if (!draft?.id) return;
		setBusy(true);
		const response = await fetch(`/api/automations/attachments/${draft.id}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/octet-stream",
				"x-filename": encodeURIComponent(file.name),
			},
			body: file,
		});
		const result = (await response.json().catch(() => null)) as {
			ok?: boolean;
			message?: string;
		} | null;
		setBusy(false);
		if (result?.ok) {
			setMessage(undefined);
			onChanged();
		} else {
			setMessage(result?.message ?? "No pudimos subir el archivo.");
		}
	}

	return (
		<main data-page="automations">
			<p>
				<Link to="/panel">Panel</Link>
			</p>
			<h1>Automatizaciones</h1>
			<p>
				Mensajes de email que se envían solos cuando un alumno se inscribe o
				termina un curso.
			</p>
			{message && <output>{message}</output>}

			<section>
				<h2>Mis automatizaciones</h2>
				{panel.automations.length === 0 && <p>Todavía no creaste ninguna.</p>}
				<ul>
					{panel.automations.map((a) => (
						<li key={a.id}>
							<strong>{a.name}</strong>{" "}
							<small>
								{TRIGGER_LABEL[a.trigger]} ·{" "}
								{a.courseName ?? "todos los cursos"} ·{" "}
								{a.enabled ? "activa" : "pausada"}
							</small>{" "}
							<button
								type="button"
								disabled={busy}
								onClick={() => setDraft(toDraft(a))}
							>
								Editar
							</button>{" "}
							<button
								type="button"
								disabled={busy}
								onClick={() =>
									run(() =>
										setAutomationEnabled({
											data: { id: a.id, enabled: !a.enabled },
										}),
									)
								}
							>
								{a.enabled ? "Desactivar" : "Activar"}
							</button>{" "}
							<button
								type="button"
								disabled={busy}
								onClick={() => {
									if (!window.confirm("¿Eliminar esta automatización?")) return;
									if (draft?.id === a.id) setDraft(null);
									void run(() => deleteAutomation({ data: { id: a.id } }));
								}}
							>
								Eliminar
							</button>
						</li>
					))}
				</ul>
				<button type="button" onClick={() => setDraft({ ...EMPTY })}>
					Nueva automatización
				</button>
			</section>

			{draft && (
				<section>
					<h2>{draft.id ? "Editar automatización" : "Nueva automatización"}</h2>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<label>
							Nombre (solo lo ves vos)
							<input
								required
								maxLength={120}
								value={draft.name}
								onChange={(e) => setDraft({ ...draft, name: e.target.value })}
							/>
						</label>
						<label>
							Cuándo se envía
							<select
								value={draft.trigger}
								onChange={(e) =>
									setDraft({
										...draft,
										trigger: e.target.value as Trigger,
										attachCertificate:
											e.target.value === "course.completed" &&
											draft.attachCertificate,
									})
								}
							>
								{TRIGGERS.map((t) => (
									<option key={t} value={t}>
										{TRIGGER_LABEL[t]}
									</option>
								))}
							</select>
						</label>
						<label>
							Curso
							<select
								value={draft.courseId}
								onChange={(e) =>
									setDraft({ ...draft, courseId: e.target.value })
								}
							>
								<option value="">Todos los cursos</option>
								{panel.courses.map((c) => (
									<option key={c.id} value={c.id}>
										{c.name}
									</option>
								))}
							</select>
						</label>
						<label>
							Asunto
							<input
								required
								maxLength={200}
								value={draft.subject}
								onChange={(e) =>
									setDraft({ ...draft, subject: e.target.value })
								}
							/>
						</label>
						<label>
							Mensaje
							<textarea
								required
								rows={8}
								maxLength={10000}
								value={draft.body}
								onChange={(e) => setDraft({ ...draft, body: e.target.value })}
							/>
						</label>
						<p>
							<small>
								Variables:{" "}
								{VARIABLES.map((v) => (
									<code key={v}>{`{{${v}}}`} </code>
								))}
								<br />
								<code>{"{{certificateUrl}}"}</code> solo tiene valor cuando el
								alumno terminó el curso y se emitió su certificado. Cada mensaje
								incluye automáticamente un enlace para darse de baja.
							</small>
						</p>
						{draft.trigger === "course.completed" && (
							<label>
								<input
									type="checkbox"
									checked={draft.attachCertificate}
									onChange={(e) =>
										setDraft({ ...draft, attachCertificate: e.target.checked })
									}
								/>{" "}
								Adjuntar el certificado (PDF)
							</label>
						)}
						<button type="submit" disabled={busy}>
							Guardar
						</button>{" "}
						<button type="button" onClick={() => setPreview(!preview)}>
							Vista previa
						</button>{" "}
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								run(
									() =>
										sendTestAutomation({
											data: {
												automationId: draft.id,
												subject: draft.subject,
												body: draft.body,
											},
										}),
									"Te enviamos una prueba a tu email.",
								)
							}
						>
							Enviarme una prueba
						</button>{" "}
						<button type="button" onClick={() => setDraft(null)}>
							Cerrar
						</button>
					</form>

					{preview && (
						<div data-preview>
							<h3>Vista previa (con datos de ejemplo)</h3>
							<p>
								<strong>
									{renderSubject(draft.subject, SAMPLE_VARIABLES)}
								</strong>
							</p>
							<p style={{ whiteSpace: "pre-wrap" }}>
								{renderText(draft.body, SAMPLE_VARIABLES)}
							</p>
						</div>
					)}

					<h3>Archivos adjuntos</h3>
					{!draft.id ? (
						<p>Guardá la automatización para poder adjuntar archivos.</p>
					) : (
						<>
							<ul>
								{(current?.attachments ?? []).map((f) => (
									<li key={f.id}>
										{f.filename} <small>({Math.ceil(f.bytes / 1024)} KB)</small>{" "}
										<button
											type="button"
											disabled={busy}
											onClick={() =>
												run(() => removeAttachment({ data: { id: f.id } }))
											}
										>
											Quitar
										</button>
									</li>
								))}
							</ul>
							<label>
								Agregar archivo
								<input
									type="file"
									disabled={busy}
									accept=".pdf,.png,.jpg,.jpeg,.zip,.docx,.xlsx,.txt"
									onChange={(e) => {
										const file = e.target.files?.[0];
										e.target.value = "";
										if (file) void upload(file);
									}}
								/>
							</label>
							<p>
								<small>
									Hasta 5 archivos de 10 MB, 15 MB en total. PDF, PNG, JPEG,
									ZIP, DOCX, XLSX o TXT.
								</small>
							</p>
						</>
					)}
				</section>
			)}

			<section>
				<h2>Últimos envíos</h2>
				{panel.deliveries.length === 0 ? (
					<p>Todavía no se envió ningún mensaje.</p>
				) : (
					<div style={{ overflowX: "auto" }}>
						<table>
							<thead>
								<tr>
									<th>Fecha</th>
									<th>Automatización</th>
									<th>Destinatario</th>
									<th>Estado</th>
									<th>Detalle</th>
								</tr>
							</thead>
							<tbody>
								{panel.deliveries.map((d) => (
									<tr key={d.id}>
										<td>
											{new Date(d.sentAt ?? d.createdAt).toLocaleString(
												"es-AR",
											)}
										</td>
										<td>{d.automationName}</td>
										<td>{d.email}</td>
										<td>{STATUS_LABEL[d.status]}</td>
										<td>{d.lastError ?? ""}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	);
}

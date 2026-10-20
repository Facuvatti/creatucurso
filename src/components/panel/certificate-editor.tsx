import { useEffect, useState } from "react";
import {
	FIELD_KEYS,
	FIELD_LABELS,
	type FieldKey,
	SAMPLE_TEXT,
	type TemplateFields,
} from "../../areas/certificates/types.ts";
import {
	type CertificatePanel,
	issuePendingCertificates,
	revokeCertificate,
	saveCertificateFields,
} from "../../server/certificates.functions.ts";

const CANVA_URL = "https://www.canva.com/";

function FrameRules() {
	return (
		<>
			<p>El diseño de fondo tiene que cumplir estas reglas:</p>
			<ul>
				<li>Archivo PDF, PNG o JPEG (no se acepta SVG). Máximo 8 MB.</li>
				<li>
					Recomendado: A4 apaisado, proporción 1,414 : 1 (con 2 % de
					tolerancia).
				</li>
				<li>Imágenes: mínimo 1754 x 1240 px y máximo 6000 px por lado.</li>
				<li>De un PDF se usa solo la primera página.</li>
				<li>
					Dejá libres los lugares del nombre, el curso, la fecha y el código:
					los ubicás abajo.
				</li>
			</ul>
			<p>
				<a href={CANVA_URL} target="_blank" rel="noreferrer noopener">
					Crear el diseño en Canva
				</a>{" "}
				(usá un tamaño personalizado de 3508 x 2480 px y descargalo como PNG o
				PDF).
			</p>
		</>
	);
}

export function CertificateEditor({
	courseId,
	panel,
	onChanged,
}: {
	courseId: string;
	panel: CertificatePanel;
	onChanged: () => void;
}) {
	const { template, issued, pending } = panel;
	const [fields, setFields] = useState<TemplateFields | null>(
		template?.fields ?? null,
	);
	const [selected, setSelected] = useState<FieldKey>("studentName");
	const [message, setMessage] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [version, setVersion] = useState(0);
	const [dragging, setDragging] = useState(false);
	const [frameUrl, setFrameUrl] = useState<string>();

	// Loaded with fetch (not as a CSS image) so the browser sends the session
	// cookie the same way in every environment and the Vite dev server accepts it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` forces a reload after an upload
	useEffect(() => {
		let objectUrl: string | undefined;
		let cancelled = false;
		fetch(`/api/certificates/frame/${courseId}?v=${version}`)
			.then((response) => (response.ok ? response.blob() : null))
			.then((blob) => {
				if (!blob || cancelled) return;
				objectUrl = URL.createObjectURL(blob);
				setFrameUrl(objectUrl);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [courseId, version]);

	// The server data changed (new frame): start from its fields again.
	const serverFields = template?.fields;
	const [seen, setSeen] = useState(serverFields);
	if (serverFields !== seen) {
		setSeen(serverFields);
		setFields(serverFields ?? null);
	}

	async function upload(file: File) {
		setBusy(true);
		setMessage(undefined);
		try {
			const response = await fetch(`/api/certificates/frame/${courseId}`, {
				method: "POST",
				headers: { "Content-Type": "application/octet-stream" },
				body: file,
			});
			const result = (await response.json().catch(() => null)) as {
				ok: boolean;
				message?: string;
			} | null;
			if (result?.ok) {
				setVersion((v) => v + 1);
				setMessage("Diseño guardado. Ubicá los textos y guardá.");
				onChanged();
			} else {
				setMessage(result?.message ?? "No se pudo subir el archivo.");
			}
		} catch {
			setMessage("No se pudo subir el archivo.");
		}
		setBusy(false);
	}

	async function run(
		action: () => Promise<{ ok: boolean; message?: string }>,
		ok: string,
	) {
		setBusy(true);
		const result = await action();
		setMessage(result.ok ? ok : result.message);
		if (result.ok) onChanged();
		setBusy(false);
	}

	function update(key: FieldKey, patch: Partial<TemplateFields[FieldKey]>) {
		setFields((current) =>
			current ? { ...current, [key]: { ...current[key], ...patch } } : current,
		);
	}

	function place(event: React.PointerEvent<HTMLDivElement>) {
		const box = event.currentTarget.getBoundingClientRect();
		const x = ((event.clientX - box.left) / box.width) * 100;
		const y = ((event.clientY - box.top) / box.height) * 100;
		const clamp = (n: number) =>
			Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
		update(selected, { x: clamp(x), y: clamp(y) });
	}

	return (
		<section data-section="certificates">
			<h2>Certificado</h2>
			<FrameRules />
			<p>
				<label>
					{template ? "Reemplazar el diseño: " : "Subir el diseño: "}
					<input
						type="file"
						accept="application/pdf,image/png,image/jpeg"
						disabled={busy}
						onChange={(event) => {
							const file = event.currentTarget.files?.[0];
							event.currentTarget.value = "";
							if (file) void upload(file);
						}}
					/>
				</label>
			</p>
			{message && <output>{message}</output>}

			{template && fields && (
				<>
					<h3>Ubicación de los textos</h3>
					<p>
						Elegí un texto y tocá o arrastrá sobre el diseño para moverlo, o usá
						los números.
					</p>
					<div style={{ maxWidth: 720 }}>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer placement; the numeric inputs below are the accessible way */}
						<div
							style={{
								position: "relative",
								width: "100%",
								aspectRatio: `${template.width} / ${template.height}`,
								containerType: "size",
								backgroundImage: frameUrl ? `url(${frameUrl})` : undefined,
								backgroundSize: "100% 100%",
								border: "1px solid #999",
								touchAction: "none",
								cursor: "crosshair",
								overflow: "hidden",
							}}
							onPointerDown={(event) => {
								event.currentTarget.setPointerCapture(event.pointerId);
								setDragging(true);
								place(event);
							}}
							onPointerMove={(event) => dragging && place(event)}
							onPointerUp={() => setDragging(false)}
							onPointerCancel={() => setDragging(false)}
						>
							{FIELD_KEYS.map((key) => {
								const f = fields[key];
								const shift =
									f.align === "center"
										? "-50%"
										: f.align === "right"
											? "-100%"
											: "0";
								return (
									<span
										key={key}
										style={{
											position: "absolute",
											left: `${f.x}%`,
											top: `${f.y}%`,
											transform: `translate(${shift}, -50%)`,
											fontSize: `${f.size}cqh`,
											lineHeight: 1,
											whiteSpace: "nowrap",
											fontFamily: "Helvetica, Arial, sans-serif",
											color: f.color,
											outline: key === selected ? "2px dashed #2563eb" : "none",
											pointerEvents: "none",
										}}
									>
										{SAMPLE_TEXT[key]}
									</span>
								);
							})}
						</div>
					</div>

					<fieldset>
						<legend>Texto a ubicar</legend>
						{FIELD_KEYS.map((key) => (
							<label key={key} style={{ display: "block" }}>
								<input
									type="radio"
									name="certificate-field"
									checked={selected === key}
									onChange={() => setSelected(key)}
								/>{" "}
								{FIELD_LABELS[key]}
							</label>
						))}
					</fieldset>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
						<label>
							Izquierda (%){" "}
							<input
								type="number"
								min={0}
								max={100}
								step={0.1}
								value={fields[selected].x}
								onChange={(e) =>
									update(selected, { x: Number(e.target.value) })
								}
							/>
						</label>
						<label>
							Arriba (%){" "}
							<input
								type="number"
								min={0}
								max={100}
								step={0.1}
								value={fields[selected].y}
								onChange={(e) =>
									update(selected, { y: Number(e.target.value) })
								}
							/>
						</label>
						<label>
							Tamaño (% del alto){" "}
							<input
								type="number"
								min={0.5}
								max={20}
								step={0.1}
								value={fields[selected].size}
								onChange={(e) =>
									update(selected, { size: Number(e.target.value) })
								}
							/>
						</label>
						<label>
							Alineación{" "}
							<select
								value={fields[selected].align}
								onChange={(e) =>
									update(selected, {
										align: e.target.value as "left" | "center" | "right",
									})
								}
							>
								<option value="left">Izquierda</option>
								<option value="center">Centro</option>
								<option value="right">Derecha</option>
							</select>
						</label>
						<label>
							Color{" "}
							<input
								type="color"
								value={fields[selected].color}
								onChange={(e) => update(selected, { color: e.target.value })}
							/>
						</label>
					</div>
					<p>
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								run(
									() => saveCertificateFields({ data: { courseId, fields } }),
									"Ubicación guardada.",
								)
							}
						>
							Guardar ubicación
						</button>{" "}
						<a
							href={`/api/certificates/preview/${courseId}`}
							target="_blank"
							rel="noreferrer noopener"
						>
							Vista previa en PDF
						</a>{" "}
						<small>(usa la ubicación guardada)</small>
					</p>

					<p>
						Se emite un certificado cuando un alumno termina el curso.{" "}
						{pending > 0
							? `Hay ${pending} alumno(s) que ya terminaron y todavía no tienen certificado.`
							: "No hay alumnos pendientes."}{" "}
						<button
							type="button"
							disabled={busy || pending === 0}
							onClick={async () => {
								setBusy(true);
								const result = await issuePendingCertificates({
									data: { courseId },
								});
								setMessage(
									result.ok
										? `Certificados emitidos: ${result.issued ?? 0}.`
										: result.message,
								);
								if (result.ok) onChanged();
								setBusy(false);
							}}
						>
							Emitir certificados pendientes
						</button>
					</p>
				</>
			)}

			<h3>Certificados emitidos</h3>
			{issued.length === 0 && <p>Todavía no se emitió ninguno.</p>}
			<ul>
				{issued.map((c) => (
					<li key={c.id}>
						{c.studentName}{" "}
						<small>
							({new Date(c.issuedAt).toLocaleDateString("es-AR")}){" "}
							<a href={`/certificados/${c.credentialId}`}>ver</a>
						</small>{" "}
						{c.status === "revoked" ? (
							<strong>
								Revocado{c.revokedReason ? `: ${c.revokedReason}` : ""}
							</strong>
						) : (
							<button
								type="button"
								disabled={busy}
								onClick={() => {
									const reason = window.prompt(
										"Motivo de la revocación (opcional):",
										"",
									);
									if (reason === null) return;
									void run(
										() =>
											revokeCertificate({
												data: { certificateId: c.id, reason },
											}),
										"Certificado revocado.",
									);
								}}
							>
								Revocar
							</button>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

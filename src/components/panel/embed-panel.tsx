import { useState } from "react";
import {
	getEmbedResults,
	rotateCourseAppSecret,
} from "../../server/catalog.functions.ts";

export type EmbedResultRow = Extract<
	Awaited<ReturnType<typeof getEmbedResults>>,
	{ ok: true }
>["rows"][number];

type Props = {
	courseId: string;
	hasSecret: boolean;
	rows: EmbedResultRow[];
	onChanged: () => void;
};

/** Course app secret (shown once) and the results reported by embedded apps. */
export function EmbedPanel({ courseId, hasSecret, rows, onChanged }: Props) {
	const [secret, setSecret] = useState<string>();
	const [message, setMessage] = useState<string>();
	const [busy, setBusy] = useState(false);

	async function rotate() {
		if (
			hasSecret &&
			!window.confirm(
				"El secreto actual deja de funcionar. ¿Generar uno nuevo?",
			)
		)
			return;
		setBusy(true);
		const result = await rotateCourseAppSecret({ data: { courseId } });
		setBusy(false);
		if (result.ok) {
			setSecret(result.secret);
			setMessage(undefined);
			onChanged();
		} else {
			setMessage(result.message);
		}
	}

	return (
		<section data-section="embed">
			<h2>App embebida: secreto y resultados</h2>
			<p>
				El secreto firma los resultados que el servidor de tu app envía a la
				plataforma. Es la única vía que cuenta como resultado verificado.
			</p>
			<p>
				{hasSecret
					? "Este curso ya tiene un secreto."
					: "Todavía no hay secreto."}
			</p>
			<button type="button" disabled={busy} onClick={rotate}>
				{hasSecret ? "Rotar secreto" : "Generar secreto"}
			</button>
			{message && <output> {message}</output>}
			{secret && (
				<div data-secret>
					<p>
						Copiá el secreto ahora: no se vuelve a mostrar.{" "}
						<button
							type="button"
							onClick={() => navigator.clipboard?.writeText(secret)}
						>
							Copiar
						</button>
					</p>
					<pre>
						<code>{secret}</code>
					</pre>
				</div>
			)}

			<h3>Cómo firmar un resultado</h3>
			<ol>
				<li>
					Armá el cuerpo JSON:{" "}
					<code>
						{'{"session": "<lessonToken>", "score": 8, "maxScore": 10}'}
					</code>
				</li>
				<li>
					Calculá <code>HMAC-SHA256</code> en hexadecimal de{" "}
					<code>timestamp + "." + cuerpo</code> con el secreto, donde el
					timestamp son los segundos Unix actuales.
				</li>
				<li>
					Enviá <code>POST /api/lessons/results</code> con los headers{" "}
					<code>X-Timestamp</code> y <code>X-Signature</code> y el mismo cuerpo
					exacto.
				</li>
			</ol>
			<p>
				El <code>lessonToken</code> lo entrega el SDK en el navegador con{" "}
				<code>LessonSDK.getSession()</code>. Más detalles en docs/lesson-sdk.md.
			</p>

			<h3>Resultados</h3>
			{rows.length === 0 ? (
				<p>Todavía no hay resultados.</p>
			) : (
				<table>
					<thead>
						<tr>
							<th>Clase</th>
							<th>Alumno</th>
							<th>Puntaje</th>
							<th>Estado</th>
							<th>Origen</th>
							<th>Fecha</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={`${row.lessonId}:${row.userEmail}`}>
								<td>{row.lessonTitle}</td>
								<td>
									{row.userName} <small>({row.userEmail})</small>
								</td>
								<td>
									{row.score !== null
										? `${row.score}${row.maxScore !== null ? ` / ${row.maxScore}` : ""}`
										: "-"}
								</td>
								<td>
									{row.passed === null
										? "-"
										: row.passed
											? "Aprobado"
											: "Desaprobado"}
								</td>
								<td>
									<small data-verified={row.verified}>
										{row.verified
											? "Resultado verificado"
											: "Reportado por el alumno"}
									</small>
								</td>
								<td>{new Date(row.updatedAt).toLocaleString("es-AR")}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	);
}

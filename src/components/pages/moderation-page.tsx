import { Link } from "@tanstack/react-router";
import type { QueueItem } from "../../server/community.functions.ts";

type Props = {
	items: QueueItem[];
	canMute: boolean;
	pending: boolean;
	message?: string | undefined;
	onDismiss: (item: QueueItem) => void;
	onDelete: (item: QueueItem) => void;
	onMute: (item: QueueItem, muted: boolean) => void;
};

export function ModerationPage({
	items,
	canMute,
	pending,
	message,
	onDismiss,
	onDelete,
	onMute,
}: Props) {
	return (
		<main data-page="moderation">
			<p>
				<Link to="/panel/tutoria">Tutoría</Link>
			</p>
			<h1>Moderación</h1>
			<p>Comentarios reportados por los alumnos.</p>
			{message && <output>{message}</output>}
			{items.length === 0 && <p>No hay comentarios reportados.</p>}
			<ul>
				{items.map((item) => (
					<li key={item.id}>
						<p>
							<small>
								{item.courseName} ·{" "}
								<Link
									to="/cursos/$courseSlug/clases/$lessonSlug"
									params={{
										courseSlug: item.courseSlug,
										lessonSlug: item.lessonSlug,
									}}
								>
									{item.lessonTitle}
								</Link>{" "}
								· {item.reports} {item.reports === 1 ? "reporte" : "reportes"}
							</small>
						</p>
						<strong>{item.authorName}</strong>
						{item.authorMuted && <small> (silenciado)</small>}
						{item.hidden && <small> (oculto)</small>}
						<p>{item.body}</p>
						<button
							type="button"
							disabled={pending}
							onClick={() => onDismiss(item)}
						>
							Descartar reportes
						</button>
						<button
							type="button"
							disabled={pending}
							onClick={() => onDelete(item)}
						>
							Eliminar
						</button>
						{canMute && (
							<button
								type="button"
								disabled={pending}
								onClick={() => onMute(item, !item.authorMuted)}
							>
								{item.authorMuted ? "Quitar silencio" : "Silenciar autor"}
							</button>
						)}
					</li>
				))}
			</ul>
		</main>
	);
}

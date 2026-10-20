import { Link } from "@tanstack/react-router";
import type { InboxItem } from "../../server/community.functions.ts";

type Props = {
	items: InboxItem[];
	pending: boolean;
	message?: string | undefined;
	isStaff: boolean;
	onReply: (item: InboxItem, body: string) => void;
	onAnswered: (item: InboxItem) => void;
};

export function TutorPanelPage({
	items,
	pending,
	message,
	isStaff,
	onReply,
	onAnswered,
}: Props) {
	return (
		<main data-page="tutor-panel">
			<p>
				{isStaff && <Link to="/panel">Panel</Link>}{" "}
				<Link to="/panel/moderacion">Moderación</Link>
			</p>
			<h1>Tutoría</h1>
			<p>Comentarios que esperan una respuesta.</p>
			{message && <output>{message}</output>}
			{items.length === 0 && (
				<p>No hay comentarios pendientes. ¡Todo al día!</p>
			)}
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
								</Link>
							</small>
						</p>
						<strong>{item.authorName}</strong>
						<p>{item.body}</p>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								const form = event.currentTarget;
								const body = String(
									new FormData(form).get("body") ?? "",
								).trim();
								if (body) onReply(item, body);
								form.reset();
							}}
						>
							<textarea
								name="body"
								required
								maxLength={10000}
								placeholder="Tu respuesta"
							/>
							<button type="submit" disabled={pending}>
								Responder
							</button>
							<button
								type="button"
								disabled={pending}
								onClick={() => onAnswered(item)}
							>
								Marcar respondido
							</button>
						</form>
					</li>
				))}
			</ul>
		</main>
	);
}

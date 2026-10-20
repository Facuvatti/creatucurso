import { useState } from "react";
import type { Comment } from "../../areas/community/types.ts";
import type { CommentsData } from "../../server/community.functions.ts";

type Props = {
	data: CommentsData;
	pending: boolean;
	message?: string | undefined;
	onPost: (values: { body: string; parentId: string | null }) => void;
	onHide: (commentId: string, hidden: boolean) => void;
};

const KIND_LABEL: Record<Comment["authorKind"], string> = {
	staff: "Equipo",
	tutor: "Tutor",
	student: "",
};

function CommentForm({
	label,
	pending,
	onSubmit,
}: {
	label: string;
	pending: boolean;
	onSubmit: (body: string) => void;
}) {
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const form = event.currentTarget;
				const body = String(new FormData(form).get("body") ?? "").trim();
				if (body) onSubmit(body);
				form.reset();
			}}
		>
			<textarea name="body" required maxLength={4000} placeholder={label} />
			<button type="submit" disabled={pending}>
				{label}
			</button>
		</form>
	);
}

export function CommentsSection({
	data,
	pending,
	message,
	onPost,
	onHide,
}: Props) {
	const [replyTo, setReplyTo] = useState<string | null>(null);
	const roots = data.comments.filter((c) => c.parentId === null);
	const repliesOf = (id: string) =>
		data.comments.filter((c) => c.parentId === id);

	const render = (comment: Comment, canReply: boolean) => (
		<li key={comment.id} data-hidden={comment.hidden || undefined}>
			<strong>{comment.authorName}</strong>
			{KIND_LABEL[comment.authorKind] && (
				<small> · {KIND_LABEL[comment.authorKind]}</small>
			)}
			{comment.hidden && <small> (oculto)</small>}
			<p>{comment.body}</p>
			{canReply && data.canPost && (
				<button
					type="button"
					onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
				>
					Responder
				</button>
			)}
			{data.canModerate && (
				<button
					type="button"
					disabled={pending}
					onClick={() => onHide(comment.id, !comment.hidden)}
				>
					{comment.hidden ? "Mostrar" : "Ocultar"}
				</button>
			)}
			{replyTo === comment.id && (
				<CommentForm
					label="Enviar respuesta"
					pending={pending}
					onSubmit={(body) => {
						onPost({ body, parentId: comment.id });
						setReplyTo(null);
					}}
				/>
			)}
		</li>
	);

	return (
		<section data-section="comments">
			<h2>Comentarios</h2>
			{roots.length === 0 && <p>Todavía no hay comentarios en esta clase.</p>}
			<ul>
				{roots.map((root) => (
					<li key={root.id} style={{ listStyle: "none" }}>
						<ul>{render(root, true)}</ul>
						{repliesOf(root.id).length > 0 && (
							<ul>{repliesOf(root.id).map((reply) => render(reply, false))}</ul>
						)}
					</li>
				))}
			</ul>
			{data.canPost && (
				<CommentForm
					label="Comentar"
					pending={pending}
					onSubmit={(body) => onPost({ body, parentId: null })}
				/>
			)}
			{message && <output>{message}</output>}
		</section>
	);
}

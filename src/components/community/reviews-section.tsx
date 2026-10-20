import type { ReviewsData } from "../../server/community.functions.ts";
import { Stars } from "./stars.tsx";

type Props = {
	data: ReviewsData;
	pending: boolean;
	message?: string | undefined;
	onSubmit: (values: { rating: number; body: string }) => void;
	onHide: (reviewId: string, hidden: boolean) => void;
};

export function ReviewsSection({
	data,
	pending,
	message,
	onSubmit,
	onHide,
}: Props) {
	const { summary } = data;

	return (
		<section data-section="reviews">
			<h2>Reseñas</h2>
			{summary.count > 0 && summary.average !== null ? (
				<p data-rating>
					<Stars value={summary.average} /> {summary.average} ({summary.count}{" "}
					{summary.count === 1 ? "reseña" : "reseñas"})
				</p>
			) : (
				<p>Todavía no hay reseñas.</p>
			)}

			{data.canReview && (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						onSubmit({
							rating: Number(form.get("rating")),
							body: String(form.get("body") ?? ""),
						});
					}}
				>
					<h3>{data.mine ? "Editar tu reseña" : "Dejá tu reseña"}</h3>
					<label>
						Puntaje
						<select name="rating" defaultValue={data.mine?.rating ?? 5}>
							{[5, 4, 3, 2, 1].map((n) => (
								<option key={n} value={n}>
									{n}
								</option>
							))}
						</select>
					</label>
					<label>
						Comentario
						<textarea
							name="body"
							maxLength={2000}
							defaultValue={data.mine?.body ?? ""}
						/>
					</label>
					<button type="submit" disabled={pending}>
						Publicar reseña
					</button>
				</form>
			)}
			{message && <output>{message}</output>}

			<ul>
				{data.reviews.map((review) => (
					<li key={review.id} data-hidden={review.hidden || undefined}>
						<Stars value={review.rating} /> <strong>{review.authorName}</strong>
						{review.hidden && <small> (oculta)</small>}
						{review.body && <p>{review.body}</p>}
						{data.canModerate && (
							<button
								type="button"
								disabled={pending}
								onClick={() => onHide(review.id, !review.hidden)}
							>
								{review.hidden ? "Mostrar" : "Ocultar"}
							</button>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

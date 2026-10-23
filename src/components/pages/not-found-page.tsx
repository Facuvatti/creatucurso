export function NotFoundPage() {
	return (
		<main data-page="not-found">
			<img src="/img/lost.svg" alt="" width="240" height="180" />
			<h1>No encontramos esta página</h1>
			<p>La dirección que buscás no existe o ya no está disponible.</p>
			<div data-actions>
				<a href="/" data-cta="primary">
					Ir al inicio
				</a>
			</div>
		</main>
	);
}

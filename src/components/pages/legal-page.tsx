// The text of the legal pages is HTML written by the owner (generated and then
// reviewed by a professional). It lives in src/content/*.html and is trusted
// content shipped with the app, never user input.
const pages = import.meta.glob("../../content/*.html", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

export function LegalPage({
	file,
	title,
}: {
	file: "privacidad" | "terminos";
	title: string;
}) {
	const html = pages[`../../content/${file}.html`]?.trim();
	return (
		<main data-page={file}>
			<h1>{title}</h1>
			{html ? (
				// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted HTML file owned by the platform owner
				<div dangerouslySetInnerHTML={{ __html: html }} />
			) : (
				<p>Este documento está en preparación.</p>
			)}
			<div data-actions>
				<a href="/" data-cta="ghost">
					Volver al inicio
				</a>
			</div>
		</main>
	);
}

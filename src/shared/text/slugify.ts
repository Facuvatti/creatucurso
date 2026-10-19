export const MAX_SLUG_LENGTH = 80;

export function slugify(text: string): string {
	const slug = text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
}

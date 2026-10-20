// Pure helpers shared by the server and the panel preview: variables and
// plain placeholder replacement (no template language).

export const TRIGGERS = ["enrollment.created", "course.completed"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const TRIGGER_LABEL: Record<Trigger, string> = {
	"enrollment.created": "Cuando un alumno se inscribe",
	"course.completed": "Cuando un alumno termina el curso",
};

export const VARIABLES = [
	"studentName",
	"courseTitle",
	"academyName",
	"certificateUrl",
] as const;
export type Variables = Record<(typeof VARIABLES)[number], string>;

export const SAMPLE_VARIABLES: Variables = {
	studentName: "Ana Pérez",
	courseTitle: "Curso de ejemplo",
	academyName: "Tu academia",
	certificateUrl: "https://tu-academia.example/certificados/ejemplo",
};

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** Replaces known `{{variables}}`; unknown ones are left as written. */
export function fillPlaceholders(
	template: string,
	values: Variables,
	transform: (value: string) => string = (value) => value,
): string {
	return template.replace(PLACEHOLDER, (whole, key: string) =>
		key in values ? transform(values[key as keyof Variables]) : whole,
	);
}

export function escapeHtmlText(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Subject: one line, so a variable can never inject a header. */
export function renderSubject(subject: string, values: Variables): string {
	return fillPlaceholders(subject, values).replace(/[\r\n]+/g, " ").trim();
}

/** Plain-text body. */
export function renderText(body: string, values: Variables): string {
	return fillPlaceholders(body, values);
}

/** HTML body: the template and every value are escaped, links are made clickable. */
export function renderHtmlBody(body: string, values: Variables): string {
	const filled = fillPlaceholders(
		escapeHtmlText(body),
		values,
		escapeHtmlText,
	);
	return filled
		.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
		.replace(/\r?\n/g, "<br>");
}

// Plain types and defaults shared by the server and the panel editor.

export type FieldKey =
	| "studentName"
	| "courseTitle"
	| "date"
	| "verificationCode";

export type FieldPlacement = {
	/** Anchor, percent of the frame width (0-100). */
	x: number;
	/** Vertical center of the text line, percent of the frame height (0-100). */
	y: number;
	/** Font size, percent of the frame height. */
	size: number;
	/** `x` is the left edge, the center or the right edge of the text. */
	align: "left" | "center" | "right";
	/** "#rrggbb" */
	color: string;
};

export type TemplateFields = Record<FieldKey, FieldPlacement>;

export const FIELD_KEYS: FieldKey[] = [
	"studentName",
	"courseTitle",
	"date",
	"verificationCode",
];

export const FIELD_LABELS: Record<FieldKey, string> = {
	studentName: "Nombre del alumno",
	courseTitle: "Nombre del curso",
	date: "Fecha de emisión",
	verificationCode: "Código de verificación",
};

export const DEFAULT_FIELDS: TemplateFields = {
	studentName: { x: 50, y: 45, size: 5, align: "center", color: "#111827" },
	courseTitle: { x: 50, y: 58, size: 3.5, align: "center", color: "#111827" },
	date: { x: 50, y: 72, size: 2.5, align: "center", color: "#374151" },
	verificationCode: {
		x: 50,
		y: 92,
		size: 1.8,
		align: "center",
		color: "#374151",
	},
};

export const SAMPLE_TEXT: Record<FieldKey, string> = {
	studentName: "María Ñandú Pérez",
	courseTitle: "Introducción a la programación",
	date: "20 de octubre de 2026",
	verificationCode: "Código: Xk3mP9qL2vT8wZ4a",
};

export type TemplateInfo = {
	width: number;
	height: number;
	fields: TemplateFields;
};

export type IssuedCertificate = {
	id: string;
	credentialId: string;
	studentName: string;
	issuedAt: string;
	status: "valid" | "revoked";
	revokedReason: string | null;
};

export type PublicCertificate = {
	credentialId: string;
	studentName: string;
	courseTitle: string;
	issuerName: string;
	issuedAt: string;
	status: "valid" | "revoked";
};

/** Hand-written check of the placement editor's input. Throws a clear message. */
export function checkFields(data: unknown): TemplateFields {
	if (typeof data !== "object" || data === null) {
		throw new Error("fields must be an object.");
	}
	const input = data as Record<string, unknown>;
	const result = {} as TemplateFields;
	for (const key of FIELD_KEYS) {
		const f = input[key] as Record<string, unknown> | undefined;
		if (typeof f !== "object" || f === null) throw new Error(`${key} is missing.`);
		const x = Number(f.x);
		const y = Number(f.y);
		const size = Number(f.size);
		if (!(x >= 0 && x <= 100) || !(y >= 0 && y <= 100)) {
			throw new Error(`${key}: x and y must be between 0 and 100.`);
		}
		if (!(size >= 0.5 && size <= 20)) {
			throw new Error(`${key}: size must be between 0.5 and 20.`);
		}
		if (f.align !== "left" && f.align !== "center" && f.align !== "right") {
			throw new Error(`${key}: invalid alignment.`);
		}
		if (typeof f.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(f.color)) {
			throw new Error(`${key}: color must be #rrggbb.`);
		}
		result[key] = { x, y, size, align: f.align, color: f.color };
	}
	return result;
}

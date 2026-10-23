import type { CourseOutline, Lesson } from "../../areas/catalog/types.ts";

/** Where the academy can be reached, as the browser sees it. */
export type AcademyAddresses = {
	academyName: string;
	/** Free subdomain, for example https://maria.creatucurso.com.ar */
	platformOrigin: string;
	/** Verified custom domain, for example https://cursos.maria.com, or null. */
	customOrigin: string | null;
};

export const SKILL_NAME = "creatucurso-lesson-app";

const MAX_DESCRIPTION = 1200;

function clip(value: string | null | undefined, max = MAX_DESCRIPTION): string {
	const text = (value ?? "").trim().replace(/\s+\n/g, "\n");
	return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function bullets(items: string[]): string {
	return items
		.map((item) => item.trim())
		.filter(Boolean)
		.map((item) => `  - ${item}`)
		.join("\n");
}

/** actividades.maria.com for cursos.maria.com; custom domains are subdomains. */
export function suggestedAppHost(customOrigin: string): string {
	const host = new URL(customOrigin).hostname;
	const labels = host.split(".");
	const rest = labels.length > 2 ? labels.slice(1) : labels;
	return ["actividades", ...rest].join(".");
}

/**
 * The prompt a creator pastes into their AI agent, next to the skill, so the
 * agent builds and publishes the app for one lesson with no back and forth.
 * Plain text: it is shown and copied as is.
 */
export function buildAgentPrompt(input: {
	course: CourseOutline;
	lesson: Lesson;
	moduleTitle: string;
	addresses: AcademyAddresses;
	hasAppSecret: boolean;
}): string {
	const { course, lesson, moduleTitle, addresses, hasAppSecret } = input;
	const primary = addresses.customOrigin ?? addresses.platformOrigin;
	const origins = [addresses.platformOrigin, addresses.customOrigin].filter(
		(origin): origin is string => origin !== null,
	);
	const lessonUrl = `${primary}/cursos/${course.slug}/clases/${lesson.slug}`;

	const program = course.modules
		.map((module) => {
			const lessons = module.lessons
				.map(
					(item) =>
						`    - ${item.title}${item.id === lesson.id ? "  ← esta clase" : ""}`,
				)
				.join("\n");
			return `  - ${module.title}\n${lessons}`;
		})
		.join("\n");

	const about = [
		clip(course.shortDescription, 300),
		clip(course.longDescription),
	]
		.filter(Boolean)
		.join("\n\n");

	const lines: string[] = [];
	const add = (...parts: string[]) => lines.push(...parts);

	add(
		`Usá la skill ${SKILL_NAME}.`,
		"",
		`Quiero una app interactiva para una clase de mi curso en creatucurso. Proponé una actividad creativa basada en el tema de la clase (que el alumno practique haciendo algo, no que lea), contámela en 2 o 3 líneas y construila completa sin esperar mi confirmación. Después publicala y dejame la URL lista para pegar en la clase.`,
		"",
		"## Curso",
		`- Academia: ${addresses.academyName}`,
		`- Curso: "${course.name}"`,
	);
	if (about) add("- De qué trata:", about.replace(/^/gm, "  "));
	if (course.learningGoals.length > 0)
		add("- Qué aprende el alumno:", bullets(course.learningGoals));
	if (course.targetStudents.length > 0)
		add("- Para quién es:", bullets(course.targetStudents));
	if (program) add("- Programa:", program);

	add(
		"",
		"## Clase donde va la app",
		`- Clase: "${lesson.title}" (módulo "${moduleTitle}")`,
	);
	if (lesson.description)
		add(
			"- Contenido de la clase:",
			clip(lesson.description).replace(/^/gm, "  "),
		);
	add(`- Dirección de la clase: ${lessonUrl}`);
	if (lesson.embedUrl)
		add(
			`- La clase ya tiene cargada la app ${lesson.embedUrl}. Si es un proyecto al que tenés acceso, mejoralo en lugar de empezar otro.`,
		);

	add(
		"",
		"## Evaluación",
		"- Al terminar, la actividad reporta un resultado: puntaje (score y maxScore), aprobado/desaprobado (passed) o ambos, lo que mejor encaje con la actividad.",
		`- Puntaje mínimo de la clase: ${lesson.embedPassingScore}. Si reportás solo puntaje, el alumno aprueba con ${lesson.embedPassingScore}% o más.`,
	);
	if (lesson.embedVerifiedOnly) {
		add(
			"- La clase exige resultado verificado: la nota la calcula un backend con datos que controla y la reporta firmada a",
			`  ${primary}/api/lessons/results`,
			"  Usá una función serverless del mismo hosting para que quede en un solo deploy.",
			`- Variables de entorno del backend: ACADEMY_URL=${primary} y COURSE_APP_SECRET. ${
				hasAppSecret
					? "El secreto del curso ya está generado en mi panel"
					: "El secreto del curso lo genero en mi panel"
			} ("App embebida: secreto y resultados"): no me lo pidas en el chat, decime dónde cargarlo.`,
			"- Además llamá LessonSDK.complete() en el navegador para que la página se actualice al instante.",
		);
	} else {
		add(
			"- Alcanza con el reporte desde el navegador (LessonSDK.complete). Hacela 100% estática, sin backend.",
		);
	}

	add(
		"",
		"## Direcciones de mi academia",
		`- SDK: <script src="${primary}/sdk/lesson-sdk.js"></script>`,
		origins.length > 1
			? `- Mi academia tiene dos direcciones (${origins.join(" y ")}): llamá LessonSDK.init() sin parentOrigin.`
			: `- parentOrigin: ${primary}`,
		`- Cabecera obligatoria de la app: Content-Security-Policy: frame-ancestors ${origins.join(" ")}`,
	);

	add("", "## Publicación");
	if (addresses.customOrigin) {
		add(
			`- Mi academia usa el dominio propio ${new URL(addresses.customOrigin).hostname}. Publicá la app en el hosting más fácil que tengas disponible (Vercel, Netlify o Cloudflare Pages, con su conector, plugin o CLI si lo tenés) y después explicame cómo conectarle el subdominio ${suggestedAppHost(addresses.customOrigin)} con un registro CNAME.`,
		);
	} else {
		add(
			"- No tengo dominio propio: publicala en el hosting más fácil que tengas disponible (Vercel, Netlify o Cloudflare Pages, con su conector, plugin o CLI si lo tenés) usando su dirección gratuita.",
		);
	}
	add(
		"- Si no podés publicar desde acá, dejame una carpeta lista para arrastrar a Netlify Drop (https://app.netlify.com/drop).",
		"",
		"## Al terminar",
		`Dame la URL final y el resumen que pide la skill. Yo la pego en el panel del curso, en la clase "${lesson.title}" → "URL de la app".`,
	);

	return lines.join("\n");
}

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	appSessionCookie,
	createCreatorWithAcademy,
	signUp,
} from "./helpers.ts";

test("a creator builds and publishes a course and a student studies it", async ({
	browser,
}) => {
	const creator = await createCreatorWithAcademy();
	const student = await signUp("Alumno Prueba");
	const site = `http://${creator.tenantHost}`;

	// --- the creator works in the panel, logged in through the handoff
	const creatorContext = await browser.newContext();
	await creatorContext.addCookies([appSessionCookie(creator.cookie)]);
	const panel = await creatorContext.newPage();
	await panel.goto(`${site}/panel`);
	await panel.waitForLoadState("networkidle");
	await expect(
		panel.getByRole("heading", { name: "Panel de la academia" }),
	).toBeVisible();

	await panel.getByLabel("Nombre", { exact: true }).fill("Curso de Python");
	await expect(panel.getByLabel("Dirección")).toHaveValue("curso-de-python");
	await panel.getByRole("button", { name: "Crear curso" }).click();
	await expect(
		panel.getByRole("heading", { name: "Curso de Python" }),
	).toBeVisible();

	// publishing an empty course is refused
	await panel.getByRole("button", { name: "Publicar" }).click();
	await expect(panel.getByText("Agregá al menos un módulo")).toBeVisible();

	await panel.getByPlaceholder("Título del módulo").fill("Primeros pasos");
	await panel.getByRole("button", { name: "Agregar módulo" }).click();
	await expect(
		panel.getByRole("heading", { name: "Primeros pasos" }),
	).toBeVisible();

	await panel.getByPlaceholder("Título de la clase").fill("Instalación");
	await panel.getByRole("button", { name: "Agregar clase" }).click();
	await expect(panel.getByText("Instalación")).toBeVisible();

	await panel.getByRole("button", { name: "Publicar" }).click();
	await expect(panel.getByText("Curso publicado.")).toBeVisible();

	// --- the example file is rejected because its instructors are not members
	await panel.goto(`${site}/panel`);
	await panel.waitForLoadState("networkidle");
	await panel.setInputFiles(
		'input[name="file"]',
		"docs/formato_curso_por_mcp.md",
	);
	await panel.getByRole("button", { name: "Importar" }).click();
	await expect(panel.locator('[data-import="errors"]')).toContainText(
		"instructors[0]",
	);

	// --- with a real instructor the same course arrives as a draft
	const example = JSON.parse(readFileSync("docs/formato_curso_por_mcp.md", "utf8"));
	example.instructors = [creator.userId];
	await panel.setInputFiles('input[name="file"]', {
		name: "curso.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(example)),
	});
	await panel.getByRole("button", { name: "Importar" }).click();
	await expect(panel.getByText("Curso creado como borrador.")).toBeVisible();
	await expect(panel.getByText("clase1.mp4").first()).toBeVisible();

	// --- an invalid file shows where the problem is
	await panel.setInputFiles('input[name="file"]', {
		name: "malo.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify({ name: "Sin módulos", modules: [] })),
	});
	await panel.getByRole("button", { name: "Importar" }).click();
	await expect(panel.locator('[data-import="errors"]')).toContainText("modules");

	// --- visitors only see the published course
	const visitor = await (await browser.newContext()).newPage();
	await visitor.goto(`${site}/`);
	await expect(visitor.getByRole("link", { name: "Curso de Python" })).toBeVisible();
	await expect(visitor.getByText("Introducción al Desarrollo Web")).toHaveCount(0);
	await visitor.goto(`${site}/cursos/introduccion-desarrollo-web`);
	await expect(visitor.getByText("No encontramos esta página")).toBeVisible();

	await visitor.goto(`${site}/cursos/curso-de-python`);
	await expect(
		visitor.getByRole("link", { name: "Ingresá para inscribirte" }),
	).toBeVisible();
	await expect(visitor.getByRole("link", { name: "Instalación" })).toHaveCount(0);

	// --- the creator enrols the student by email
	await panel.goto(`${site}/panel`);
	await panel.getByRole("link", { name: "Curso de Python" }).click();
	await panel.waitForLoadState("networkidle");
	await panel.getByPlaceholder("Email de la persona").fill(student.email);
	await panel.getByRole("button", { name: "Inscribir" }).click();
	await expect(panel.getByText("Persona inscripta.")).toBeVisible();

	// --- the student studies and completes the lesson
	const studentContext = await browser.newContext();
	await studentContext.addCookies([appSessionCookie(student.cookie)]);
	const learner = await studentContext.newPage();
	await learner.goto(`${site}/cursos/curso-de-python`);
	await learner.waitForLoadState("networkidle");
	await learner.getByRole("link", { name: "Ingresá para inscribirte" }).click();
	await learner.waitForURL(`${site}/cursos/curso-de-python`);
	await learner.waitForLoadState("networkidle");
	await learner.getByRole("link", { name: "Entrar al curso" }).click();
	await expect(
		learner.getByRole("heading", { name: "Instalación" }),
	).toBeVisible();
	await learner.waitForLoadState("networkidle");
	await learner.getByRole("button", { name: "Marcar como completada" }).click();
	await expect(learner.locator('[data-status="completed"]')).toBeVisible();

	// --- someone not enrolled cannot open the lesson
	const stranger = await signUp("Curiosa");
	const strangerContext = await browser.newContext();
	await strangerContext.addCookies([appSessionCookie(stranger.cookie)]);
	const outsider = await strangerContext.newPage();
	await outsider.goto(`${site}/cursos/curso-de-python`);
	await outsider.waitForLoadState("networkidle");
	await outsider.getByRole("link", { name: "Ingresá para inscribirte" }).click();
	await outsider.waitForURL(`${site}/cursos/curso-de-python`);
	await outsider.goto(`${site}/cursos/curso-de-python/clases/instalacion`);
	await expect(
		outsider.getByRole("heading", { name: "Necesitás estar inscripto" }),
	).toBeVisible();

});

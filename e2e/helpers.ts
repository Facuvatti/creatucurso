import { randomBytes } from "node:crypto";
import { expect } from "@playwright/test";
import { Client } from "pg";
import { send } from "./http.ts";
import { e2eDatabaseUrl, port } from "./support.ts";

export const appHost = `app.localhost:${port}`;
export const landingHost = `localhost:${port}`;
export const unique = () => randomBytes(4).toString("hex");

export async function markAsCreator(email: string) {
	const db = new Client({ connectionString: e2eDatabaseUrl });
	await db.connect();
	try {
		await db.query(
			`update auth."user" set "isCreator" = true where email = $1`,
			[email],
		);
	} finally {
		await db.end();
	}
}

export async function signUp(name = "Persona Prueba") {
	const email = `person-${unique()}@example.com`;
	const reply = await send("POST", appHost, "/api/auth/sign-up/email", {
		json: { name, email, password: "correct-horse-battery" },
	});
	expect(reply.status).toBe(200);
	expect(reply.sessionCookie).not.toBeNull();
	const userId = (JSON.parse(reply.body) as { user: { id: string } }).user.id;
	return { email, userId, cookie: reply.sessionCookie as string };
}

export async function createCreatorWithAcademy() {
	const person = await signUp("Creadora Prueba");
	await markAsCreator(person.email);
	const slug = `academia-${unique()}`;
	const created = await send("POST", appHost, "/api/auth/organization/create", {
		cookie: person.cookie,
		json: { name: "Academia de Prueba", slug },
	});
	expect(created.status).toBe(200);
	return { ...person, slug, tenantHost: `${slug}.localhost:${port}` };
}

/** Cookie for the central app, ready to give to a browser context. */
export function appSessionCookie(cookie: string) {
	const [name, ...rest] = cookie.split("=");
	return {
		name: name as string,
		value: rest.join("="),
		url: `http://${appHost}`,
	};
}

import { expect, test } from "@playwright/test";
import { send } from "./http.ts";
import {
	appHost,
	createCreatorWithAcademy,
	landingHost,
	markAsCreator,
	signUp,
	unique,
} from "./helpers.ts";
import { port } from "./support.ts";

const handoffFor = (tenantHost: string) =>
	`/handoff?return=${encodeURIComponent(`http://${tenantHost}/`)}`;

test.describe("login and session handoff", () => {
	test("gives a creator a host-only session on their own site", async () => {
		const creator = await createCreatorWithAcademy();

		const link = await send("GET", appHost, handoffFor(creator.tenantHost), {
			cookie: creator.cookie,
		});
		expect(link.status).toBe(302);
		expect(link.location).toContain(
			`http://${creator.tenantHost}/auth/handoff?token=`,
		);

		const redeemPath = (link.location as string).replace(
			`http://${creator.tenantHost}`,
			"",
		);
		const redeemed = await send("GET", creator.tenantHost, redeemPath);
		expect(redeemed.status).toBe(302);
		expect(redeemed.location).toBe("/");
		expect(redeemed.sessionCookie).not.toBeNull();
		expect(redeemed.setCookie.join(";").toLowerCase()).not.toContain("domain=");

		const home = await send("GET", creator.tenantHost, "/", {
			cookie: redeemed.sessionCookie as string,
		});
		expect(home.body).toContain('data-session="active"');
		expect(home.body).toContain("owner");
	});

	test("accepts the handoff link only once", async () => {
		const creator = await createCreatorWithAcademy();
		const link = await send("GET", appHost, handoffFor(creator.tenantHost), {
			cookie: creator.cookie,
		});
		const redeemPath = (link.location as string).replace(
			`http://${creator.tenantHost}`,
			"",
		);

		const first = await send("GET", creator.tenantHost, redeemPath);
		const second = await send("GET", creator.tenantHost, redeemPath);

		expect(first.sessionCookie).not.toBeNull();
		expect(second.sessionCookie).toBeNull();
	});

	test("ends the session on logout", async () => {
		const creator = await createCreatorWithAcademy();
		const link = await send("GET", appHost, handoffFor(creator.tenantHost), {
			cookie: creator.cookie,
		});
		const redeemPath = (link.location as string).replace(
			`http://${creator.tenantHost}`,
			"",
		);
		const redeemed = await send("GET", creator.tenantHost, redeemPath);
		const cookie = redeemed.sessionCookie as string;

		const loggedOut = await send("POST", creator.tenantHost, "/auth/logout", {
			cookie,
		});
		expect(loggedOut.status).toBe(303);

		const home = await send("GET", creator.tenantHost, "/", { cookie });
		expect(home.body).not.toContain('data-session="active"');
	});

	test("sends visitors without a session to the login page", async () => {
		const reply = await send("GET", appHost, handoffFor("maria.localhost:3100"));

		expect(reply.status).toBe(302);
		expect(reply.location).toMatch(/^\/login\?return=/);
	});

	test("refuses return addresses that are not creator sites", async () => {
		const { cookie } = await signUp();

		for (const target of [
			"https://evil.example/",
			`http://ghost.localhost:${port}/`,
			`http://${appHost}/`,
		]) {
			const reply = await send(
				"GET",
				appHost,
				`/handoff?return=${encodeURIComponent(target)}`,
				{ cookie },
			);
			expect(reply.status).toBe(400);
		}
	});

	test("only exists on the app host", async () => {
		expect((await send("GET", landingHost, "/handoff")).status).toBe(404);
		expect((await send("GET", landingHost, "/login")).status).toBe(404);
		expect((await send("GET", appHost, "/login")).status).toBe(200);
	});
});

test.describe("creating an academy", () => {
	test("is refused to people who are not creators", async () => {
		const { cookie } = await signUp();

		const reply = await send("POST", appHost, "/api/auth/organization/create", {
			cookie,
			json: { name: "Intento", slug: `intento-${unique()}` },
		});

		expect(reply.status).toBeGreaterThanOrEqual(400);
		expect(reply.status).toBeLessThan(500);
	});

	test("refuses reserved and malformed addresses", async () => {
		const person = await signUp();
		await markAsCreator(person.email);

		for (const slug of ["admin", "www", "Mi Academia", "ab"]) {
			const reply = await send("POST", appHost, "/api/auth/organization/create", {
				cookie: person.cookie,
				json: { name: "Prueba", slug },
			});
			expect(reply.status).toBe(400);
		}
	});
});

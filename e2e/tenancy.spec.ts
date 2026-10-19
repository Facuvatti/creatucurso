import { type APIRequestContext, expect, test } from "@playwright/test";
import { port } from "./support.ts";

async function visit(request: APIRequestContext, host: string, path = "/") {
	const response = await request.get(`http://127.0.0.1:${port}${path}`, {
		headers: { host },
		failOnStatusCode: false,
	});
	return { status: response.status(), html: await response.text() };
}

test.describe("tenant resolution by host", () => {
	test("serves the landing page on the platform domain", async ({ request }) => {
		const { status, html } = await visit(request, `localhost:${port}`);

		expect(status).toBe(200);
		expect(html).toContain('data-page="landing"');
	});

	test("serves the central app on the app host", async ({ request }) => {
		const { status, html } = await visit(request, `app.localhost:${port}`);

		expect(status).toBe(200);
		expect(html).toContain('data-page="app-home"');
	});

	test("serves a creator site on its subdomain with its own title", async ({
		request,
	}) => {
		const { status, html } = await visit(request, `maria.localhost:${port}`);

		expect(status).toBe(200);
		expect(html).toContain('data-page="tenant-home"');
		expect(html).toContain("Maria Courses");
		expect(html).toMatch(/<title[^>]*>[^<]*Maria Courses[^<]*<\/title>/);
	});

	test("serves a creator site on a verified custom domain", async ({
		request,
	}) => {
		const { status, html } = await visit(request, "maria-courses.test");

		expect(status).toBe(200);
		expect(html).toContain('data-page="tenant-home"');
		expect(html).toContain("Maria Courses");
	});

	test("answers 404 for a subdomain nobody owns", async ({ request }) => {
		const { status, html } = await visit(request, `ghost.localhost:${port}`);

		expect(status).toBe(404);
		expect(html).not.toContain('data-page="tenant-home"');
	});

	test("answers 404 for a custom domain that is not verified", async ({
		request,
	}) => {
		const { status } = await visit(request, "pending-site.test");

		expect(status).toBe(404);
	});

	test("answers 404 for malformed hosts", async ({ request }) => {
		const { status } = await visit(request, `a.b.localhost:${port}`);

		expect(status).toBe(404);
	});
});

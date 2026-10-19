import { describe, expect, it } from "vitest";
import { classifyHost } from "./classify-host.ts";

const production = { platformDomain: "example.com" };
const development = { platformDomain: "localhost" };

describe("classifyHost", () => {
	it("recognises the landing page on the apex and www", () => {
		expect(classifyHost("example.com", production)).toEqual({
			kind: "landing",
		});
		expect(classifyHost("www.example.com", production)).toEqual({
			kind: "landing",
		});
	});

	it("recognises the central app host", () => {
		expect(classifyHost("app.example.com", production)).toEqual({
			kind: "platform-app",
		});
	});

	it("treats a single label under the platform domain as a creator subdomain", () => {
		expect(classifyHost("maria.example.com", production)).toEqual({
			kind: "subdomain",
			slug: "maria",
		});
	});

	it("normalises case, port and trailing dot", () => {
		expect(classifyHost("MARIA.Example.com:3000", production)).toEqual({
			kind: "subdomain",
			slug: "maria",
		});
		expect(classifyHost("maria.example.com.", production)).toEqual({
			kind: "subdomain",
			slug: "maria",
		});
	});

	it("treats any other valid domain as a custom domain", () => {
		expect(classifyHost("maria-courses.com", production)).toEqual({
			kind: "custom-domain",
			domain: "maria-courses.com",
		});
	});

	it("does not confuse look-alike domains with creator subdomains", () => {
		expect(classifyHost("evilexample.com", production)).toEqual({
			kind: "custom-domain",
			domain: "evilexample.com",
		});
		expect(classifyHost("maria.example.com.evil.com", production)).toEqual({
			kind: "custom-domain",
			domain: "maria.example.com.evil.com",
		});
	});

	it("rejects reserved subdomains", () => {
		for (const reserved of ["api", "admin", "mail", "static", "cdn", "media"]) {
			expect(classifyHost(`${reserved}.example.com`, production)).toEqual({
				kind: "unknown",
			});
		}
	});

	it("rejects nested subdomains", () => {
		expect(classifyHost("a.b.example.com", production)).toEqual({
			kind: "unknown",
		});
	});

	it("rejects empty, malformed and IP hosts", () => {
		for (const host of [
			"",
			"   ",
			"bad_host.example.com",
			"-bad.example.com",
			"bad-.example.com",
			"192.168.0.1",
			"[::1]",
			"localhost",
			"has space.com",
		]) {
			expect(classifyHost(host, production)).toEqual({ kind: "unknown" });
		}
	});

	it("rejects labels longer than 63 characters", () => {
		const long = "a".repeat(64);

		expect(classifyHost(`${long}.example.com`, production)).toEqual({
			kind: "unknown",
		});
	});

	it("works the same way with localhost in development", () => {
		expect(classifyHost("localhost:3000", development)).toEqual({
			kind: "landing",
		});
		expect(classifyHost("app.localhost:3000", development)).toEqual({
			kind: "platform-app",
		});
		expect(classifyHost("maria.localhost:3000", development)).toEqual({
			kind: "subdomain",
			slug: "maria",
		});
	});
});

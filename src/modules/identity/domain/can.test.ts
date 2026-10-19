import { describe, expect, it } from "vitest";
import { can } from "./can.ts";

describe("can", () => {
	it("lets the owner manage courses and billing", () => {
		expect(can(["owner"], { course: ["update", "publish"] })).toBe(true);
		expect(can(["owner"], { billing: ["manage"] })).toBe(true);
	});

	it("keeps billing away from admins", () => {
		expect(can(["admin"], { course: ["publish"] })).toBe(true);
		expect(can(["admin"], { billing: ["manage"] })).toBe(false);
	});

	it("limits tutors to answering comments and reading", () => {
		expect(can(["tutor"], { comment: ["reply", "moderate"] })).toBe(true);
		expect(can(["tutor"], { course: ["read"] })).toBe(true);
		expect(can(["tutor"], { course: ["update"] })).toBe(false);
	});

	it("limits students to learning actions", () => {
		expect(can(["student"], { review: ["create"] })).toBe(true);
		expect(can(["student"], { exam: ["attempt"] })).toBe(true);
		expect(can(["student"], { review: ["moderate"] })).toBe(false);
		expect(can(["student"], { course: ["create"] })).toBe(false);
	});

	it("accepts a permission granted by any of several roles", () => {
		expect(can(["student", "tutor"], { comment: ["moderate"] })).toBe(true);
	});

	it("denies unknown roles and empty role lists", () => {
		expect(can(["hacker"], { course: ["read"] })).toBe(false);
		expect(can([], { course: ["read"] })).toBe(false);
	});
});

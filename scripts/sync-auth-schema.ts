import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceGeneratedSection } from "../src/shared/database/generated-section.ts";
import { createTempDatabase } from "../src/shared/database/temp-database.ts";

const SCHEMA_FILE = "database/schema.sql";
const AUTH_CONFIG = "src/server/auth.server.ts";
const adminUrl =
	process.env.DATABASE_URL ??
	"postgres://creatucurso:creatucurso@localhost:5432/creatucurso";
const checkOnly = process.argv.includes("--check");

// `generate` only emits what is missing from the database it connects to,
// so it must run against an empty throwaway database.
const temp = await createTempDatabase(adminUrl);
const workDir = mkdtempSync(join(tmpdir(), "auth-schema-"));
const output = join(workDir, "auth.sql");

try {
	execFileSync(
		"pnpm",
		["exec", "auth", "generate", "--config", AUTH_CONFIG, "--output", output, "-y"],
		{ env: { ...process.env, DATABASE_URL: temp.url }, stdio: "pipe" },
	);

	const current = existsSync(SCHEMA_FILE) ? readFileSync(SCHEMA_FILE, "utf8") : "";
	const next = replaceGeneratedSection(current, readFileSync(output, "utf8"));

	if (checkOnly) {
		if (next !== current) {
			console.error(`${SCHEMA_FILE} is out of date. Run \`pnpm db:auth\`.`);
			process.exitCode = 1;
		} else {
			console.log(`${SCHEMA_FILE} is up to date.`);
		}
	} else {
		writeFileSync(SCHEMA_FILE, next);
		console.log(`${SCHEMA_FILE} updated.`);
	}
} finally {
	rmSync(workDir, { recursive: true, force: true });
	await temp.drop();
}

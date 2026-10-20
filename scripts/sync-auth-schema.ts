import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

try {
	process.loadEnvFile();
} catch {
	// No .env file: use the variables already set.
}

const SCHEMA_FILE = "database/schema.sql";
const AUTH_CONFIG = "src/server/auth.server.ts";
const BEGIN_MARKER =
	"-- >>> better-auth generated (do not edit by hand; run `pnpm db:auth`) >>>";
const END_MARKER = "-- <<< better-auth generated <<<";
const adminUrl =
	process.env.DATABASE_URL ??
	"postgres://creatucurso:creatucurso@localhost:5432/creatucurso";
const checkOnly = process.argv.includes("--check");

/** Puts the generated SQL between the markers, keeping everything else. */
function replaceGeneratedSection(content: string, generated: string): string {
	const section = [BEGIN_MARKER, generated.trim(), END_MARKER].join("\n");
	const begin = content.indexOf(BEGIN_MARKER);
	const end = content.indexOf(END_MARKER);

	if (begin === -1 && end === -1) {
		const separator = content === "" || content.endsWith("\n") ? "" : "\n";
		return `${content}${separator}${section}\n`;
	}
	if (begin === -1 || end === -1 || end < begin) {
		throw new Error("schema file has a broken generated-section marker");
	}
	return (
		content.slice(0, begin) + section + content.slice(end + END_MARKER.length)
	);
}

async function runOn(url: string, sql: string) {
	const client = new Client({ connectionString: url });
	await client.connect();
	try {
		await client.query(sql);
	} finally {
		await client.end();
	}
}

// `generate` only emits what is missing from the database it connects to,
// so it must run against an empty throwaway database.
const tempName = `tmp_${randomBytes(6).toString("hex")}`;
await runOn(adminUrl, `CREATE DATABASE ${tempName}`);
const tempUrl = new URL(adminUrl);
tempUrl.pathname = `/${tempName}`;

const workDir = mkdtempSync(join(tmpdir(), "auth-schema-"));
const output = join(workDir, "auth.sql");

try {
	execFileSync(
		"pnpm",
		["exec", "auth", "generate", "--config", AUTH_CONFIG, "--output", output, "-y"],
		{
			env: { ...process.env, DATABASE_URL: tempUrl.toString() },
			stdio: "pipe",
		},
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
	await runOn(adminUrl, `DROP DATABASE IF EXISTS ${tempName} WITH (FORCE)`);
}

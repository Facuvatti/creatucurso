// Creates the SES configuration set of every academy that has none yet
// (docs/ses-setup.md). Safe to run again. Usage: node scripts/provision-ses-tenants.ts
try {
	process.loadEnvFile();
} catch {
	// No env file: the variables come from the environment.
}

const { pool } = await import("../src/server/db.server.ts");
const { ensureTenantSending } = await import(
	"../src/areas/automations/sending.ts"
);
const { sesConfigured } = await import("../src/server/email.server.ts");

if (!sesConfigured()) {
	console.error(
		"SES is not configured (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SES_FROM_EMAIL).",
	);
	process.exit(1);
}

const { rows } = await pool.query<{ id: string }>(
	"select id from auth.organization order by id",
);
let failed = 0;
for (const { id } of rows) {
	try {
		const name = await ensureTenantSending(id);
		console.log(`ok ${id} ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`failed ${id} ${error instanceof Error ? error.name : "error"}`);
	}
}
await pool.end();
process.exit(failed ? 1 : 0);

export {};

// Admin only: re-enables the SES configuration set of a paused academy and marks
// it active (docs/mails.md section 4). Usage: node scripts/resume-ses-tenant.ts <organizationId>
try {
	process.loadEnvFile();
} catch {
	// No env file: the variables come from the environment.
}

const organizationId = process.argv[2];
if (!organizationId) {
	console.error("Usage: node scripts/resume-ses-tenant.ts <organizationId>");
	process.exit(1);
}

const { pool } = await import("../src/server/db.server.ts");
const { resumeTenantSending } = await import(
	"../src/areas/automations/sending.ts"
);

await resumeTenantSending(organizationId);
console.log(`resumed ${organizationId}`);
await pool.end();

export {};

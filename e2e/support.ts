export const port = 3100;

const baseUrl =
	process.env.DATABASE_URL ??
	"postgres://creatucurso:creatucurso@localhost:5432/creatucurso";

function withDatabase(name: string): string {
	const url = new URL(baseUrl);
	url.pathname = `/${name}`;
	return url.toString();
}

export const e2eDatabaseName = "creatucurso_e2e";

// Creating and dropping databases happens from the maintenance database,
// so it works whatever database DATABASE_URL currently points to.
export const adminDatabaseUrl = withDatabase("postgres");

export const e2eDatabaseUrl = withDatabase(e2eDatabaseName);

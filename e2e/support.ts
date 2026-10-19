export const port = 3100;

export const adminDatabaseUrl =
	process.env.DATABASE_URL ??
	"postgres://creatucurso:creatucurso@localhost:5432/creatucurso";

export const e2eDatabaseName = "creatucurso_e2e";

export const e2eDatabaseUrl = (() => {
	const url = new URL(adminDatabaseUrl);
	url.pathname = `/${e2eDatabaseName}`;
	return url.toString();
})();

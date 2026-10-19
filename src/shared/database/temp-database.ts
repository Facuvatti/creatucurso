import { randomBytes } from "node:crypto";
import { Client } from "pg";

export type TempDatabase = {
	url: string;
	drop: () => Promise<void>;
};

async function withClient<T>(
	url: string,
	run: (client: Client) => Promise<T>,
): Promise<T> {
	const client = new Client({ connectionString: url });
	await client.connect();
	try {
		return await run(client);
	} finally {
		await client.end();
	}
}

export async function createTempDatabase(
	adminUrl: string,
): Promise<TempDatabase> {
	const name = `tmp_${randomBytes(6).toString("hex")}`;
	await withClient(adminUrl, (client) =>
		client.query(`CREATE DATABASE ${name}`),
	);

	const url = new URL(adminUrl);
	url.pathname = `/${name}`;

	return {
		url: url.toString(),
		drop: () =>
			withClient(adminUrl, (client) =>
				client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
			).then(() => undefined),
	};
}

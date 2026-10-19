import { request } from "node:http";
import { port } from "./support.ts";

export type Reply = {
	status: number;
	location: string | null;
	sessionCookie: string | null;
	setCookie: string[];
	body: string;
};

type Options = { cookie?: string; json?: unknown };

/** Plain HTTP call with full control of the Host header and no cookie jar. */
export function send(
	method: "GET" | "POST",
	host: string,
	path: string,
	{ cookie, json }: Options = {},
): Promise<Reply> {
	const payload = json === undefined ? undefined : JSON.stringify(json);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path,
				method,
				headers: {
					host,
					origin: `http://${host}`,
					...(cookie ? { cookie } : {}),
					...(payload
						? {
								"content-type": "application/json",
								"content-length": Buffer.byteLength(payload),
							}
						: {}),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => {
					const setCookie = res.headers["set-cookie"] ?? [];
					const session = setCookie.find((value) =>
						value.startsWith("better-auth.session_token="),
					);
					resolve({
						status: res.statusCode ?? 0,
						location: res.headers.location ?? null,
						sessionCookie: session ? (session.split(";")[0] ?? null) : null,
						setCookie,
						body: Buffer.concat(chunks).toString("utf8"),
					});
				});
			},
		);
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});
}

import { createServerFn } from "@tanstack/react-start";
import {
	disconnect,
	type GmailStatus,
	gmailAvailable,
	gmailStatus,
	isPlatformAdmin,
	PLATFORM_OWNER,
	startConnection,
} from "../areas/automations/gmail.ts";
import { readRequestContext, requireStaffContext } from "./request.server.ts";

type Result = { ok: true } | { ok: false; message: string };
type StartResult = { ok: true; url: string } | { ok: false; message: string };

const NOT_CONFIGURED =
	"El envío con Gmail todavía no está disponible en esta instalación.";
const FAILED = "No pudimos iniciar la conexión con Gmail. Intentá de nuevo.";

/** Only the owner or an admin of the academy manages its Gmail. */
async function requireOwnerOrAdmin() {
	const context = await requireStaffContext();
	if (!context.roles.includes("owner") && !context.roles.includes("admin")) {
		throw new Error("No tenés permiso para hacer esto.");
	}
	return context;
}

export const startGmailConnection = createServerFn({
	method: "POST",
}).handler(async (): Promise<StartResult> => {
	const { tenant, user, origin } = await requireOwnerOrAdmin();
	if (!gmailAvailable()) return { ok: false, message: NOT_CONFIGURED };
	try {
		const url = await startConnection({
			ownerKey: tenant.id,
			userId: user.id,
			returnOrigin: origin,
		});
		return { ok: true, url };
	} catch (error) {
		console.error(
			"Starting the Gmail connection failed",
			(error as Error).name,
		);
		return { ok: false, message: FAILED };
	}
});

export const disconnectGmail = createServerFn({ method: "POST" }).handler(
	async (): Promise<Result> => {
		const { tenant } = await requireOwnerOrAdmin();
		await disconnect(tenant.id);
		return { ok: true };
	},
);

// ------------------------------------------------- platform mailbox (/admin/correo)

/** The request comes from the app host and from the user whose email is PLATFORM_ADMIN_EMAIL. */
async function requirePlatformAdmin() {
	const context = await readRequestContext();
	if (
		context.host.kind !== "platform-app" ||
		!context.user ||
		!isPlatformAdmin(context.user.email)
	) {
		throw new Error("No tenés permiso para hacer esto.");
	}
	return { ...context, user: context.user };
}

export const getPlatformMail = createServerFn({ method: "GET" }).handler(
	async (): Promise<GmailStatus & { available: boolean }> => {
		await requirePlatformAdmin();
		return {
			...(await gmailStatus(PLATFORM_OWNER)),
			available: gmailAvailable(),
		};
	},
);

export const startPlatformGmail = createServerFn({ method: "POST" }).handler(
	async (): Promise<StartResult> => {
		const { user, appOrigin } = await requirePlatformAdmin();
		if (!gmailAvailable()) return { ok: false, message: NOT_CONFIGURED };
		try {
			const url = await startConnection({
				ownerKey: PLATFORM_OWNER,
				userId: user.id,
				returnOrigin: appOrigin,
			});
			return { ok: true, url };
		} catch (error) {
			console.error(
				"Starting the platform Gmail failed",
				(error as Error).name,
			);
			return { ok: false, message: FAILED };
		}
	},
);

export const disconnectPlatformGmail = createServerFn({
	method: "POST",
}).handler(async (): Promise<Result> => {
	await requirePlatformAdmin();
	await disconnect(PLATFORM_OWNER);
	return { ok: true };
});

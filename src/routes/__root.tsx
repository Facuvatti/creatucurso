import {
	createRootRoute,
	HeadContent,
	notFound,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { can } from "../areas/identity/permissions.ts";
import { BillingNotice } from "../components/pages/billing-panel-page.tsx";
import { NotFoundPage } from "../components/pages/not-found-page.tsx";
import { getRequestContext } from "../server/request-context.functions.ts";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	beforeLoad: async () => {
		const context = await getRequestContext();
		if (context.host.kind === "unknown") throw notFound();
		return context;
	},
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Creatucurso" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	notFoundComponent: NotFoundPage,
	shellComponent: RootDocument,
	component: RootLayout,
});

/** Every page of an academy: the past-due / suspended notice (ADR-0029), then the page. */
function RootLayout() {
	const { billing, roles } = Route.useRouteContext();
	return (
		<>
			{billing && (
				<BillingNotice
					billing={billing}
					staff={can(roles, { course: ["update"] })}
					owner={can(roles, { billing: ["manage"] })}
				/>
			)}
			<Outlet />
		</>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="es">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}

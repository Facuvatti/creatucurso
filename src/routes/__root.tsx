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
import { SiteFooter } from "../components/ui/site-footer.tsx";
import { SiteHeader } from "../components/ui/site-header.tsx";
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
			{ name: "theme-color", content: "#4f46e5" },
			{ title: "Creatucurso" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: "/favicon.ico", sizes: "48x48" },
			{
				rel: "icon",
				type: "image/png",
				sizes: "32x32",
				href: "/favicon-32.png",
			},
			{
				rel: "icon",
				type: "image/png",
				sizes: "192x192",
				href: "/icon-192.png",
			},
			{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
		],
	}),
	notFoundComponent: NotFoundPage,
	shellComponent: RootDocument,
	component: RootLayout,
});

const PLATFORM_NAME = "Crea tu curso";

/** Every page: site header, the past-due / suspended notice (ADR-0029), the page, site footer. */
function RootLayout() {
	const { billing, roles, host, user, origin, appOrigin } =
		Route.useRouteContext();
	const academy = host.kind === "tenant";
	const loginUrl =
		host.kind === "platform-app"
			? "/login"
			: `${appOrigin}/login${academy ? `?return=${encodeURIComponent(`${origin}/`)}` : ""}`;
	const brand = host.kind === "tenant" ? host.tenant.name : PLATFORM_NAME;
	return (
		<>
			<SiteHeader
				brand={brand}
				academy={academy}
				signedIn={user !== null}
				loginUrl={loginUrl}
			/>
			{billing && (
				<BillingNotice
					billing={billing}
					staff={can(roles, { course: ["update"] })}
					owner={can(roles, { billing: ["manage"] })}
				/>
			)}
			<Outlet />
			<SiteFooter brand={brand} />
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

import { createFileRoute } from "@tanstack/react-router";
import { AppHomePage } from "../components/pages/app-home-page.tsx";
import { LandingPage } from "../components/pages/landing-page.tsx";
import { TenantHomePage } from "../components/pages/tenant-home-page.tsx";
import { getAppHome } from "../server/academy.functions.ts";

export const Route = createFileRoute("/")({
	loader: async ({ context }) => ({
		home:
			context.host.kind === "platform-app" && context.user
				? await getAppHome()
				: { academies: [], studying: [] },
	}),
	head: ({ match }) => {
		const { host } = match.context;
		const title =
			host.kind === "tenant"
				? host.tenant.name
				: host.kind === "platform-app"
					? "Panel | Creatucurso"
					: "Creatucurso: creá y vendé tus cursos online";
		return { meta: [{ title }] };
	},
	component: Home,
});

function Home() {
	const { host, user, roles, origin, appOrigin } = Route.useRouteContext();
	const { home } = Route.useLoaderData();

	if (host.kind === "tenant") {
		const loginUrl = `${appOrigin}/login?return=${encodeURIComponent(`${origin}/`)}`;
		return (
			<TenantHomePage
				tenant={host.tenant}
				user={user}
				roles={roles}
				loginUrl={loginUrl}
			/>
		);
	}
	if (host.kind === "platform-app") {
		return (
			<AppHomePage
				user={user}
				academies={home.academies}
				studying={home.studying}
			/>
		);
	}
	return <LandingPage />;
}

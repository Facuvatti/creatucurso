import { createFileRoute } from "@tanstack/react-router";
import { can } from "../areas/identity/permissions.ts";
import { AppHomePage } from "../components/pages/app-home-page.tsx";
import { LandingPage } from "../components/pages/landing-page.tsx";
import { TenantHomePage } from "../components/pages/tenant-home-page.tsx";
import { getAppHome } from "../server/academy.functions.ts";
import { getTenantHome } from "../server/community.functions.ts";

const emptyTenantHome = { courses: [], featured: [] };

export const Route = createFileRoute("/")({
	loader: async ({ context }) => {
		if (context.host.kind === "tenant") {
			return {
				tenantHome: await getTenantHome(),
				home: { academies: [], studying: [] },
			};
		}
		if (context.host.kind === "platform-app" && context.user) {
			return { tenantHome: emptyTenantHome, home: await getAppHome() };
		}
		return {
			tenantHome: emptyTenantHome,
			home: { academies: [], studying: [] },
		};
	},
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
	const { tenantHome, home } = Route.useLoaderData();

	if (host.kind === "tenant") {
		const loginUrl = `${appOrigin}/login?return=${encodeURIComponent(`${origin}/`)}`;
		return (
			<TenantHomePage
				tenant={host.tenant}
				courses={tenantHome.courses}
				featured={tenantHome.featured}
				user={user}
				roles={roles}
				isStaff={can(roles, { course: ["update"] })}
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
	return <LandingPage appOrigin={appOrigin} />;
}

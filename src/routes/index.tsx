import { createFileRoute } from "@tanstack/react-router";
import { AppHomePage } from "../components/pages/app-home-page.tsx";
import { LandingPage } from "../components/pages/landing-page.tsx";
import { TenantHomePage } from "../components/pages/tenant-home-page.tsx";
import { can } from "../modules/identity/domain/can.ts";
import { getAppHome } from "../server/academy.functions.ts";
import { getTenantCatalog } from "../server/catalog.functions.ts";

export const Route = createFileRoute("/")({
	loader: async ({ context }) => {
		if (context.host.kind === "tenant") {
			return {
				courses: await getTenantCatalog(),
				home: { academies: [], studying: [] },
			};
		}
		if (context.host.kind === "platform-app" && context.user) {
			return { courses: [], home: await getAppHome() };
		}
		return { courses: [], home: { academies: [], studying: [] } };
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
	const { courses, home } = Route.useLoaderData();

	if (host.kind === "tenant") {
		const loginUrl = `${appOrigin}/login?return=${encodeURIComponent(`${origin}/`)}`;
		return (
			<TenantHomePage
				tenant={host.tenant}
				courses={courses}
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
	return <LandingPage />;
}

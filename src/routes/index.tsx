import { createFileRoute } from "@tanstack/react-router";
import { AppHomePage } from "../components/pages/app-home-page.tsx";
import { LandingPage } from "../components/pages/landing-page.tsx";
import { TenantHomePage } from "../components/pages/tenant-home-page.tsx";
import type { HostResolution } from "../modules/tenancy/application/resolve-tenant.ts";

function titleFor(host: HostResolution | undefined): string {
	switch (host?.kind) {
		case "tenant":
			return host.tenant.name;
		case "platform-app":
			return "Panel | Creatucurso";
		default:
			return "Creatucurso: creá y vendé tus cursos online";
	}
}

export const Route = createFileRoute("/")({
	loader: ({ context }) => context.host,
	head: ({ loaderData }) => ({ meta: [{ title: titleFor(loaderData) }] }),
	component: Home,
});

function Home() {
	const host = Route.useLoaderData();

	switch (host.kind) {
		case "tenant":
			return <TenantHomePage tenant={host.tenant} />;
		case "platform-app":
			return <AppHomePage />;
		default:
			return <LandingPage />;
	}
}

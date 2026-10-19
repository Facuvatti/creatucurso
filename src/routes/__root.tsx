import {
	createRootRoute,
	HeadContent,
	notFound,
	Scripts,
} from "@tanstack/react-router";
import { NotFoundPage } from "../components/pages/not-found-page.tsx";
import { getHostResolution } from "../server/host.functions.ts";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	beforeLoad: async () => {
		const host = await getHostResolution();
		if (host.kind === "unknown") throw notFound();
		return { host };
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
});

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

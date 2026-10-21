import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "../components/pages/legal-page.tsx";

export const Route = createFileRoute("/privacidad")({
	head: () => ({ meta: [{ title: "Política de privacidad | Creatucurso" }] }),
	component: () => (
		<LegalPage file="privacidad" title="Política de privacidad" />
	),
});

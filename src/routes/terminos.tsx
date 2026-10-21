import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "../components/pages/legal-page.tsx";

export const Route = createFileRoute("/terminos")({
	head: () => ({ meta: [{ title: "Términos y condiciones | Creatucurso" }] }),
	component: () => (
		<LegalPage file="terminos" title="Términos y condiciones" />
	),
});

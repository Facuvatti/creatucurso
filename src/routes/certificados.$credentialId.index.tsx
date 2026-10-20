import { createFileRoute, notFound } from "@tanstack/react-router";
import { CertificatePage } from "../components/pages/certificate-page.tsx";
import { getPublicCertificate } from "../server/certificates.functions.ts";

// Named `.index` so the sibling `/pdf` server route is not nested inside this page.
export const Route = createFileRoute("/certificados/$credentialId/")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
	},
	loader: async ({ params }) => {
		const certificate = await getPublicCertificate({
			data: { credentialId: params.credentialId },
		});
		if (!certificate) throw notFound();
		return certificate;
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `Certificado de ${loaderData.studentName} | ${loaderData.courseTitle}`
					: "Certificado",
			},
			...(loaderData
				? [
						{
							name: "description",
							content: `${loaderData.studentName} completó ${loaderData.courseTitle} en ${loaderData.issuerName}.`,
						},
					]
				: []),
		],
	}),
	component: CertificateRoute,
});

function CertificateRoute() {
	const certificate = Route.useLoaderData();
	const { origin } = Route.useRouteContext();
	return <CertificatePage certificate={certificate} origin={origin} />;
}

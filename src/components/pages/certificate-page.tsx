import { useState } from "react";
import type { PublicCertificate } from "../../areas/certificates/types.ts";

const LINKEDIN_URL =
	"https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME";

function CopyField({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<li>
			<strong>{label}:</strong> <span>{value}</span>{" "}
			<button
				type="button"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(value);
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					} catch {
						window.prompt("Copiá el texto:", value);
					}
				}}
			>
				{copied ? "Copiado" : "Copiar"}
			</button>
		</li>
	);
}

export function CertificatePage({
	certificate,
	origin,
}: {
	certificate: PublicCertificate;
	origin: string;
}) {
	const issued = new Date(certificate.issuedAt);
	const zone = "America/Argentina/Buenos_Aires";
	const date = issued.toLocaleDateString("es-AR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: zone,
	});
	const month = issued.toLocaleDateString("es-AR", {
		month: "long",
		timeZone: zone,
	});
	const year = issued.toLocaleDateString("es-AR", {
		year: "numeric",
		timeZone: zone,
	});
	const url = `${origin}/certificados/${certificate.credentialId}`;
	const valid = certificate.status === "valid";

	return (
		<main data-page="certificate">
			<h1>Certificado</h1>
			{valid ? (
				<p data-status="valid">
					<strong>Certificado válido</strong>
				</p>
			) : (
				<p data-status="revoked" role="alert">
					<strong>Este certificado fue revocado y ya no es válido.</strong>
				</p>
			)}
			<dl>
				<dt>Titular</dt>
				<dd>{certificate.studentName}</dd>
				<dt>Curso</dt>
				<dd>{certificate.courseTitle}</dd>
				<dt>Emitido por</dt>
				<dd>{certificate.issuerName}</dd>
				<dt>Fecha de emisión</dt>
				<dd>{date}</dd>
				<dt>ID de la credencial</dt>
				<dd>{certificate.credentialId}</dd>
			</dl>

			{valid && (
				<>
					<p>
						<a href={`/certificados/${certificate.credentialId}/pdf`}>
							Descargar el certificado en PDF
						</a>
					</p>
					<section>
						<h2>Agregalo a LinkedIn</h2>
						<p>
							Abrí el formulario de LinkedIn y pegá estos datos en cada campo.
						</p>
						<ul>
							<CopyField
								label="Nombre del certificado"
								value={certificate.courseTitle}
							/>
							<CopyField
								label="Organización emisora"
								value={certificate.issuerName}
							/>
							<CopyField label="Mes de emisión" value={month} />
							<CopyField label="Año de emisión" value={year} />
							<CopyField label="URL de la credencial" value={url} />
							<CopyField
								label="ID de la credencial"
								value={certificate.credentialId}
							/>
						</ul>
						<p>
							<a href={LINKEDIN_URL} target="_blank" rel="noreferrer noopener">
								Abrir el formulario de LinkedIn
							</a>
						</p>
					</section>
				</>
			)}
		</main>
	);
}

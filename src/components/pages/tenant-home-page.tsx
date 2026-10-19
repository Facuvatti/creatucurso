import type { Tenant } from "../../modules/tenancy/domain/tenant.ts";

export function TenantHomePage({ tenant }: { tenant: Tenant }) {
	return (
		<main data-page="tenant-home">
			<h1>{tenant.name}</h1>
			<p>Los cursos de {tenant.name} van a aparecer acá.</p>
		</main>
	);
}

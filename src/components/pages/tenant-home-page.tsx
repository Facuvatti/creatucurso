import type { Tenant } from "../../modules/tenancy/domain/tenant.ts";

type Props = {
	tenant: Tenant;
	user: { name: string } | null;
	roles: string[];
	loginUrl: string;
};

export function TenantHomePage({ tenant, user, roles, loginUrl }: Props) {
	return (
		<main data-page="tenant-home">
			<h1>{tenant.name}</h1>
			<p>Los cursos de {tenant.name} van a aparecer acá.</p>
			{user ? (
				<div data-session="active">
					<p>
						Hola, {user.name}
						{roles.length > 0 && <> ({roles.join(", ")})</>}.
					</p>
					<form method="post" action="/auth/logout">
						<button type="submit">Salir</button>
					</form>
				</div>
			) : (
				<a href={loginUrl}>Ingresar</a>
			)}
		</main>
	);
}

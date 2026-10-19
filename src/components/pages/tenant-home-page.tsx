import { Link } from "@tanstack/react-router";
import type { CourseSummary } from "../../modules/catalog/domain/types.ts";
import type { Tenant } from "../../modules/tenancy/domain/tenant.ts";

type Props = {
	tenant: Tenant;
	courses: CourseSummary[];
	user: { name: string } | null;
	roles: string[];
	isStaff: boolean;
	loginUrl: string;
};

export function TenantHomePage({
	tenant,
	courses,
	user,
	roles,
	isStaff,
	loginUrl,
}: Props) {
	return (
		<main data-page="tenant-home">
			<h1>{tenant.name}</h1>
			<nav>
				{user ? (
					<div data-session="active">
						<p>
							Hola, {user.name}
							{roles.length > 0 && <> ({roles.join(", ")})</>}.
						</p>
						{isStaff && <Link to="/panel">Panel de la academia</Link>}
						<form method="post" action="/auth/logout">
							<button type="submit">Salir</button>
						</form>
					</div>
				) : (
					<a href={loginUrl}>Ingresar</a>
				)}
			</nav>

			<section>
				<h2>Cursos</h2>
				{courses.length === 0 ? (
					<p>Todavía no hay cursos publicados.</p>
				) : (
					<ul>
						{courses.map((course) => (
							<li key={course.id}>
								<Link
									to="/cursos/$courseSlug"
									params={{ courseSlug: course.slug }}
								>
									{course.name}
								</Link>
								{course.shortDescription && <p>{course.shortDescription}</p>}
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}

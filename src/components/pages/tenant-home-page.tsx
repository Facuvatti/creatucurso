import { Link } from "@tanstack/react-router";
import type { Tenant } from "../../areas/tenancy/tenants.ts";
import type {
	CourseWithRating,
	FeaturedWithCourse,
} from "../../server/community.functions.ts";
import { Stars } from "../community/stars.tsx";

type Props = {
	tenant: Tenant;
	courses: CourseWithRating[];
	featured: FeaturedWithCourse[];
	user: { name: string } | null;
	roles: string[];
	isStaff: boolean;
	loginUrl: string;
};

export function TenantHomePage({
	tenant,
	courses,
	featured,
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
								{course.rating.average !== null && (
									<p data-rating>
										<Stars value={course.rating.average} />{" "}
										{course.rating.average} ({course.rating.count})
									</p>
								)}
								{course.shortDescription && <p>{course.shortDescription}</p>}
							</li>
						))}
					</ul>
				)}
			</section>
			{featured.length > 0 && (
				<section data-section="featured-reviews">
					<h2>Lo que dicen los alumnos</h2>
					<ul>
						{featured.map((review) => (
							<li key={review.id}>
								<Stars value={review.rating} /> {review.body}
								<br />
								<small>
									{review.authorName} sobre{" "}
									<Link
										to="/cursos/$courseSlug"
										params={{ courseSlug: review.courseSlug }}
									>
										{review.courseName}
									</Link>
								</small>
							</li>
						))}
					</ul>
				</section>
			)}
		</main>
	);
}

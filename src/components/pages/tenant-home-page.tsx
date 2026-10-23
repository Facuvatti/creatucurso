import { Link } from "@tanstack/react-router";
import type { Tenant } from "../../areas/tenancy/tenants.ts";
import type {
	CourseWithRating,
	FeaturedWithCourse,
} from "../../server/community.functions.ts";
import { Stars } from "../community/stars.tsx";
import { CourseCover } from "../ui/course-cover.tsx";

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
						<div data-actions>
							{isStaff && (
								<Link to="/panel" data-cta="primary">
									Panel de la academia
								</Link>
							)}
							{roles.length > 0 && <Link to="/mensajes">Mensajes</Link>}
							<form method="post" action="/auth/logout">
								<button type="submit">Salir</button>
							</form>
						</div>
					</div>
				) : (
					<a href={loginUrl} data-cta="primary">
						Ingresar
					</a>
				)}
			</nav>

			<section>
				<h2>Cursos</h2>
				{courses.length === 0 ? (
					<div data-empty>
						<img
							src="/img/empty.svg"
							alt=""
							width="160"
							height="120"
							loading="lazy"
						/>
						<p>Todavía no hay cursos publicados.</p>
					</div>
				) : (
					<ul data-grid="cards">
						{courses.map((course) => (
							<li key={course.id}>
								<CourseCover name={course.name} />
								<div data-card-body>
									<h3>{course.name}</h3>
									{course.rating.average !== null && (
										<p data-rating>
											<Stars value={course.rating.average} />{" "}
											{course.rating.average} ({course.rating.count})
										</p>
									)}
									{course.shortDescription && <p>{course.shortDescription}</p>}
									<div data-actions>
										<Link
											to="/cursos/$courseSlug"
											params={{ courseSlug: course.slug }}
											data-cta="primary"
										>
											Ver curso
										</Link>
									</div>
								</div>
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

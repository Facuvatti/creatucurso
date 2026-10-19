type Link = { name: string; url: string };

type Props = {
	user: { name: string; email: string } | null;
	academies: Link[];
	studying: Link[];
};

// Links go through /handoff so the creator's site receives the logged-in session.
const through = (url: string) => `/handoff?return=${encodeURIComponent(url)}`;

export function AppHomePage({ user, academies, studying }: Props) {
	return (
		<main data-page="app-home">
			<h1>Panel de Creatucurso</h1>
			{user ? (
				<>
					<p>Hola, {user.name}.</p>
					<section>
						<h2>Mis academias</h2>
						{academies.length === 0 ? (
							<p>Todavía no creaste ninguna academia.</p>
						) : (
							<ul>
								{academies.map((academy) => (
									<li key={academy.url}>
										<a href={through(academy.url)}>{academy.name}</a>
									</li>
								))}
							</ul>
						)}
						<a href="/crear-academia">Crear mi academia</a>
					</section>
					<section>
						<h2>Mis cursos</h2>
						{studying.length === 0 ? (
							<p>Todavía no estás inscripto en ningún curso.</p>
						) : (
							<ul>
								{studying.map((academy) => (
									<li key={academy.url}>
										<a href={through(academy.url)}>{academy.name}</a>
									</li>
								))}
							</ul>
						)}
					</section>
					<form method="post" action="/auth/logout">
						<button type="submit">Salir</button>
					</form>
				</>
			) : (
				<>
					<p>
						Ingresá para administrar tus cursos o estudiar los que compraste.
					</p>
					<a href="/login">Ingresar</a>
				</>
			)}
		</main>
	);
}

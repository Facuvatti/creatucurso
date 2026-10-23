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
			<h1>Panel de Crea tu curso</h1>
			{user ? (
				<>
					<p>Hola, {user.name}.</p>
					<section>
						<h2>Mis academias</h2>
						{academies.length === 0 ? (
							<div data-empty>
								<img
									src="/img/empty.svg"
									alt=""
									width="160"
									height="120"
									loading="lazy"
								/>
								<p>Todavía no creaste ninguna academia.</p>
							</div>
						) : (
							<ul data-grid="cards">
								{academies.map((academy) => (
									<li key={academy.url}>
										<div data-card-body>
											<h3>{academy.name}</h3>
											<div data-actions>
												<a href={through(academy.url)} data-cta="primary">
													Abrir academia
												</a>
											</div>
										</div>
									</li>
								))}
							</ul>
						)}
						<div data-actions>
							<a href="/crear-academia" data-cta="primary">
								Crear mi academia
							</a>
						</div>
					</section>
					<section>
						<h2>Mis cursos</h2>
						{studying.length === 0 ? (
							<div data-empty>
								<img
									src="/img/empty.svg"
									alt=""
									width="160"
									height="120"
									loading="lazy"
								/>
								<p>Todavía no estás inscripto en ningún curso.</p>
							</div>
						) : (
							<ul data-grid="cards">
								{studying.map((academy) => (
									<li key={academy.url}>
										<div data-card-body>
											<h3>{academy.name}</h3>
											<div data-actions>
												<a href={through(academy.url)} data-cta="primary">
													Abrir academia
												</a>
											</div>
										</div>
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
					<div data-actions>
						<a href="/login" data-cta="primary" data-size="lg">
							Ingresar
						</a>
					</div>
				</>
			)}
		</main>
	);
}

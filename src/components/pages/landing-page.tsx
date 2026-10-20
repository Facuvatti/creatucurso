type Props = {
	/** Origin of the central app, for example https://app.creatucurso.com */
	appOrigin: string;
};

const steps = [
	{
		title: "Creá tu cuenta",
		text: "Registrate con tu email o con Google. Es gratis.",
	},
	{
		title: "Armá tu academia",
		text: "Elegí el nombre y la dirección de tu sitio. Después cargá tu curso, tus clases y tus videos.",
	},
	{
		title: "Conectá tus cobros y publicá",
		text: "Conectá tu cuenta de pagos, poné el precio y publicá. Tus alumnos pagan y empiezan a estudiar.",
	},
];

const faq = [
	{
		question: "¿Cuánto cuesta?",
		answer:
			"Crear tu academia no tiene costo inicial. Los detalles de precios los vamos a publicar antes del lanzamiento.",
	},
	{
		question: "¿Quién cobra los pagos?",
		answer:
			"Vos. Los pagos van directo a tu cuenta de pagos; la plataforma no retiene tu dinero.",
	},
	{
		question: "¿Puedo usar mi propio dominio?",
		answer:
			"Sí. Empezás con una dirección propia dentro de la plataforma y después podés conectar tu dominio, por ejemplo cursos.tunegocio.com.",
	},
	{
		question: "¿Mis videos están protegidos?",
		answer:
			"Sí. Los videos se reproducen solo para alumnos inscriptos y no se pueden descargar con un enlace directo.",
	},
	{
		question: "¿Puedo devolver el dinero a un alumno?",
		answer: "Sí. Podés hacer reembolsos desde tu panel.",
	},
];

export function LandingPage({ appOrigin }: Props) {
	const signUpUrl = `${appOrigin}/login?return=${encodeURIComponent(`${appOrigin}/crear-academia`)}`;

	return (
		<main data-page="landing">
			<header>
				<h1>Creatucurso</h1>
				<p>
					Creá y vendé tus cursos online desde tu propio sitio, con tu
					subdominio o tu dominio. Cobrás directo en tu cuenta y tus videos
					quedan protegidos.
				</p>
				<p>
					<a href={signUpUrl}>Crear mi academia</a>
				</p>
				<p>
					¿Ya tenés cuenta? <a href={`${appOrigin}/login`}>Ingresar</a>
				</p>
			</header>

			<section>
				<h2>Cómo empezar</h2>
				<ol>
					{steps.map((step) => (
						<li key={step.title}>
							<strong>{step.title}.</strong> {step.text}
						</li>
					))}
				</ol>
			</section>

			<section>
				<h2>Preguntas frecuentes</h2>
				{faq.map((item) => (
					<details key={item.question}>
						<summary>{item.question}</summary>
						<p>{item.answer}</p>
					</details>
				))}
			</section>

			<footer>
				<a href="/terminos">Términos y condiciones</a>{" "}
				<a href="/privacidad">Política de privacidad</a>
			</footer>
		</main>
	);
}

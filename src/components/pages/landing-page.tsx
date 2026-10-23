type Props = {
	/** Origin of the central app, for example https://app.creatucurso.com */
	appOrigin: string;
};

const features = [
	{
		image: "/img/feature-domain.svg",
		title: "Tu propio sitio",
		text: "Empezás con tu subdominio y después podés conectar tu propio dominio.",
	},
	{
		image: "/img/feature-payments.svg",
		title: "Cobros directos",
		text: "Los pagos van directo a tu cuenta de pagos; la plataforma no retiene tu dinero.",
	},
	{
		image: "/img/feature-video.svg",
		title: "Videos protegidos",
		text: "Tus videos se reproducen solo para alumnos inscriptos.",
	},
	{
		image: "/img/feature-certificate.svg",
		title: "Certificados y exámenes",
		text: "Evaluá a tus alumnos con exámenes y entregales un certificado al terminar.",
	},
];

const steps = [
	{
		image: "/img/step-account.svg",
		title: "Creá tu cuenta",
		text: "Registrate con tu email o con Google. Es gratis.",
	},
	{
		image: "/img/step-academy.svg",
		title: "Armá tu academia",
		text: "Elegí el nombre y la dirección de tu sitio. Después cargá tu curso, tus clases y tus videos.",
	},
	{
		image: "/img/step-pay.svg",
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
				<div data-hero-copy>
					<p data-eyebrow>Crea tu curso: plataforma para creadores de cursos</p>
					<h1>Creá y vendé tus cursos online</h1>
					<p>
						Creá y vendé tus cursos online desde tu propio sitio, con tu
						subdominio o tu dominio. Cobrás directo en tu cuenta y tus videos
						quedan protegidos.
					</p>
					<div data-actions>
						<a href={signUpUrl} data-cta="primary" data-size="lg">
							Crear mi academia
						</a>
						<a href={`${appOrigin}/login`} data-size="lg">
							Ingresar
						</a>
					</div>
					<p data-trust>
						Crear tu academia no tiene costo inicial. Los pagos van directo a tu
						cuenta.
					</p>
				</div>
				<div data-hero-art>
					<img
						src="/img/hero.svg"
						alt="Vista de una academia con un curso en video"
						width="640"
						height="520"
					/>
				</div>
			</header>

			<section data-section="features">
				<h2>Todo lo que necesitás para vender tus cursos</h2>
				<ul data-grid="features">
					{features.map((feature) => (
						<li key={feature.title}>
							<img
								src={feature.image}
								alt=""
								width="64"
								height="64"
								loading="lazy"
							/>
							<h3>{feature.title}</h3>
							<p>{feature.text}</p>
						</li>
					))}
				</ul>
			</section>

			<section>
				<h2>Cómo empezar</h2>
				<ol>
					{steps.map((step) => (
						<li key={step.title}>
							<img
								src={step.image}
								alt=""
								width="96"
								height="96"
								loading="lazy"
							/>
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

			<section data-section="cta">
				<h2>¿Listo para publicar tu primer curso?</h2>
				<div data-actions>
					<a href={signUpUrl} data-cta="primary" data-size="lg">
						Crear mi academia
					</a>
				</div>
			</section>
		</main>
	);
}

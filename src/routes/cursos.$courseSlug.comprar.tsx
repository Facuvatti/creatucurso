import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { CheckoutPage } from "../components/pages/checkout-page.tsx";
import { getCoursePage } from "../server/catalog.functions.ts";
import {
	type CheckoutSession,
	startCourseCheckout,
} from "../server/payments.functions.ts";

type HyperWidgets = {
	create: (
		type: "payment",
		options: Record<string, unknown>,
	) => { mount: (selector: string) => void };
};
type Hyper = {
	widgets: (options: { clientSecret: string }) => HyperWidgets;
	confirmPayment: (options: {
		widgets: HyperWidgets;
		confirmParams: { return_url: string };
		redirect?: "always" | "if_required";
	}) => Promise<{ error?: { message?: string }; status?: string }>;
};
declare global {
	interface Window {
		Hyper?: (key: string, options?: Record<string, unknown>) => Hyper;
	}
}

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (document.querySelector(`script[src="${src}"]`)) return resolve();
		const script = document.createElement("script");
		script.src = src;
		script.onload = () => resolve();
		script.onerror = () =>
			reject(new Error("No pudimos cargar el formulario de pago."));
		document.body.appendChild(script);
	});
}

export const Route = createFileRoute("/cursos/$courseSlug/comprar")({
	beforeLoad: ({ context, params }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/cursos/${params.courseSlug}`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
	},
	loader: async ({ params }) => {
		const result = await getCoursePage({
			data: { courseSlug: params.courseSlug },
		});
		if (result.kind !== "found") throw notFound();
		const { course, access } = result;
		if (access.canStudy) {
			throw redirect({
				to: "/cursos/$courseSlug",
				params: { courseSlug: course.slug },
			});
		}
		if (!course.priceAmount || !course.currency) {
			throw redirect({
				to: "/cursos/$courseSlug",
				params: { courseSlug: course.slug },
			});
		}
		return {
			name: course.name,
			slug: course.slug,
			amount: course.priceAmount,
			currency: course.currency,
		};
	},
	head: () => ({ meta: [{ title: "Comprar curso" }] }),
	component: CheckoutRoute,
});

function CheckoutRoute() {
	const course = Route.useLoaderData();
	const [step, setStep] = useState<"idle" | "starting" | "ready" | "paying">(
		"idle",
	);
	const [error, setError] = useState<string>();
	const session = useRef<Extract<CheckoutSession, { ok: true }>>(null);
	const hyper = useRef<Hyper>(null);
	const widgets = useRef<HyperWidgets>(null);

	async function start() {
		setStep("starting");
		setError(undefined);
		const result = await startCourseCheckout({
			data: { courseSlug: course.slug },
		});
		if (!result.ok) {
			setError(result.message);
			return setStep("idle");
		}
		try {
			await loadScript(result.sdkUrl);
			if (!window.Hyper)
				throw new Error("El formulario de pago no está disponible.");
			session.current = result;
			hyper.current = window.Hyper(result.publishableKey, {
				customBackendUrl: result.backendUrl,
			});
			widgets.current = hyper.current.widgets({
				clientSecret: result.clientSecret,
			});
			widgets.current
				.create("payment", { layout: "tabs" })
				.mount("#payment-element");
			setStep("ready");
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "No pudimos iniciar el pago.",
			);
			setStep("idle");
		}
	}

	async function pay() {
		if (!hyper.current || !widgets.current || !session.current) return;
		setStep("paying");
		const { error: payError } = await hyper.current.confirmPayment({
			widgets: widgets.current,
			confirmParams: { return_url: session.current.returnUrl },
			redirect: "always",
		});
		if (payError) {
			setError(payError.message ?? "El pago no se pudo completar.");
			setStep("ready");
		}
	}

	return (
		<CheckoutPage
			courseName={course.name}
			courseSlug={course.slug}
			amount={course.amount}
			currency={course.currency}
			step={step}
			error={error}
			onStart={start}
			onPay={pay}
		/>
	);
}

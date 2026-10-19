import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
	getPurchaseStatus,
	type PurchaseStatus,
} from "../server/payments.functions.ts";

export const Route = createFileRoute("/cursos/$courseSlug/compra")({
	validateSearch: z.object({ payment_id: z.string().optional() }),
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
	},
	head: () => ({ meta: [{ title: "Tu compra" }] }),
	component: PurchaseResult,
});

function PurchaseResult() {
	const { courseSlug } = Route.useParams();
	const { payment_id: paymentId } = Route.useSearch();
	const [status, setStatus] = useState<PurchaseStatus>({
		kind: "pending",
		courseSlug,
	});

	useEffect(() => {
		if (!paymentId) return;
		let cancelled = false;
		async function poll(attempt: number) {
			const next = await getPurchaseStatus({
				data: { paymentId: paymentId as string },
			});
			if (cancelled) return;
			setStatus(next);
			if (next.kind === "pending" && attempt < 20) {
				setTimeout(() => poll(attempt + 1), 3000);
			}
		}
		poll(0);
		return () => {
			cancelled = true;
		};
	}, [paymentId]);

	return (
		<main data-page="purchase-result">
			{!paymentId || status.kind === "unknown" ? (
				<>
					<h1>No encontramos esta compra</h1>
					<Link to="/cursos/$courseSlug" params={{ courseSlug }}>
						Volver al curso
					</Link>
				</>
			) : status.kind === "succeeded" ? (
				<>
					<h1 data-status="paid">¡Pago confirmado!</h1>
					<p>Ya tenés acceso al curso.</p>
					<Link
						to="/cursos/$courseSlug"
						params={{ courseSlug: status.courseSlug }}
					>
						Ir al curso
					</Link>
				</>
			) : status.kind === "failed" ? (
				<>
					<h1 data-status="failed">El pago no se completó</h1>
					<Link to="/cursos/$courseSlug/comprar" params={{ courseSlug }}>
						Intentar de nuevo
					</Link>
				</>
			) : (
				<>
					<h1 data-status="pending">Estamos confirmando tu pago…</h1>
					<p>Esto puede tardar unos segundos.</p>
				</>
			)}
		</main>
	);
}

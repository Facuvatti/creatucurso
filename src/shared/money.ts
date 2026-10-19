/** Formats an amount in minor units (cents) for people, for example 4999 ARS. */
export function formatMoney(amount: number, currency: string): string {
	return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(
		amount / 100,
	);
}

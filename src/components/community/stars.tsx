export function Stars({ value }: { value: number }) {
	const full = Math.round(value);
	return (
		<span role="img" aria-label={`${value} de 5 estrellas`}>
			{"★".repeat(full)}
			{"☆".repeat(5 - full)}
		</span>
	);
}

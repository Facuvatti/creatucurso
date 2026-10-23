type Props = {
	name: string;
	/** Picks the gradient. Defaults to the course name so the same course keeps its color. */
	seed?: string;
};

// Same family as the logo: blue, violet, green, orange.
const palettes = [
	["#0ea5e9", "#4f46e5"],
	["#6366f1", "#7c3aed"],
	["#10b981", "#0ea5e9"],
	["#f59e0b", "#f97316"],
	["#8b5cf6", "#ec4899"],
	["#14b8a6", "#4f46e5"],
] as const;

function pick(seed: string) {
	let hash = 0;
	for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return palettes[hash % palettes.length] ?? palettes[0];
}

/** Decorative cover for courses without an image. Sized by the CSS of its container. */
export function CourseCover({ name, seed }: Props) {
	const [from, to] = pick(seed ?? name);
	return (
		<div
			data-cover
			aria-hidden="true"
			style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
		>
			<svg viewBox="0 0 120 80" role="presentation" focusable="false">
				<title>{name}</title>
				<circle cx="102" cy="14" r="26" fill="#fff" fillOpacity="0.1" />
				<circle cx="14" cy="76" r="32" fill="#fff" fillOpacity="0.09" />
				<g transform="translate(60 40)">
					<path d="M0-20l30 12-30 12-30-12z" fill="#fff" />
					<path
						d="M-18-1v12c0 5 8 9 18 9s18-4 18-9V-1L0 5z"
						fill="#fff"
						fillOpacity="0.8"
					/>
					<path
						d="M27-5v16"
						stroke="#fff"
						strokeWidth="2.500"
						strokeLinecap="round"
					/>
				</g>
			</svg>
		</div>
	);
}

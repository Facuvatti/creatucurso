import { useState } from "react";
import { slugify } from "../../shared/text/slugify.ts";

type Props = {
	error?: string | undefined;
	pending: boolean;
	domainSuffix: string;
	onSubmit: (values: { name: string; slug: string }) => void;
};

export function CreateAcademyPage({
	error,
	pending,
	domainSuffix,
	onSubmit,
}: Props) {
	const [name, setName] = useState("");
	const [customSlug, setCustomSlug] = useState<string | null>(null);
	const slug = customSlug ?? slugify(name);

	return (
		<main data-page="create-academy">
			<h1>Creá tu academia</h1>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit({ name, slug });
				}}
			>
				<label>
					Nombre de tu academia
					<input
						name="name"
						required
						minLength={2}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<label>
					Tu dirección
					<input
						name="slug"
						required
						value={slug}
						onChange={(event) => setCustomSlug(event.target.value)}
					/>
					<span>.{domainSuffix}</span>
				</label>
				{error && <p role="alert">{error}</p>}
				<button type="submit" disabled={pending}>
					Crear academia
				</button>
			</form>
		</main>
	);
}

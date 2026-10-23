import { useEffect, useMemo, useState } from "react";
import type { CourseOutline } from "../../areas/catalog/types.ts";
import {
	type AcademyAddresses,
	buildAgentPrompt,
	SKILL_NAME,
} from "./embed-agent-prompt.ts";

const ZIP_URL = `/skills/${SKILL_NAME}.zip`;
const SKILL_URL = `/skills/${SKILL_NAME}/SKILL.md`;

type Platform = "claude" | "chatgpt" | "gemini" | "kimi";

const STEPS: Record<Platform, string> = {
	claude:
		"Se descargó creatucurso-lesson-app.zip. En Claude (Personalizar → Skills) tocá + → Crear skill → Subir una skill y elegí el .zip. Necesitás tener activada la ejecución de código (Configuración → Capacidades).",
	chatgpt:
		"Se descargó creatucurso-lesson-app.zip. En ChatGPT abrí Plugins → pestaña Skills → Crear → Subir desde tu computadora y elegí el .zip. Las skills dependen de tu plan de ChatGPT.",
	gemini:
		"Se descargó SKILL.md. En Gemini abrí Personalizar → Skills → Crear → Subir, elegí el SKILL.md y tocá Crear.",
	kimi: "Copiamos la skill al portapapeles. En Kimi, en modo Agente, pegá el mensaje y envialo: Kimi crea la skill. Después usala con /creatucurso-lesson-app.",
};

const PLATFORMS: { id: Platform; label: string; url: string }[] = [
	{ id: "claude", label: "Claude", url: "https://claude.ai/customize/skills" },
	{ id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
	{ id: "gemini", label: "Gemini", url: "https://gemini.google.com/" },
	{ id: "kimi", label: "Kimi", url: "https://www.kimi.com/" },
];

async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		return;
	} catch {
		// Fall back below (insecure context or permission denied).
	}
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.append(area);
	area.select();
	document.execCommand("copy");
	area.remove();
}

function download(href: string, filename: string) {
	const link = document.createElement("a");
	link.href = href;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
}

async function fetchSkill(): Promise<string> {
	const response = await fetch(SKILL_URL);
	if (!response.ok) throw new Error("skill");
	return response.text();
}

type Props = {
	course: CourseOutline;
	addresses: AcademyAddresses;
	hasAppSecret: boolean;
};

/** Skill download and ready-made prompt so the creator's AI agent builds the lesson app. */
export function EmbedAgentKit({ course, addresses, hasAppSecret }: Props) {
	const [platform, setPlatform] = useState<Platform>();
	const [skillText, setSkillText] = useState<string>();
	const [skillError, setSkillError] = useState(false);
	const [skillCopied, setSkillCopied] = useState(false);
	const [promptCopied, setPromptCopied] = useState(false);

	const entries = useMemo(
		() =>
			course.modules.flatMap((module) =>
				module.lessons.map((lesson) => ({ lesson, moduleTitle: module.title })),
			),
		[course],
	);
	const defaultId = (entries.find((e) => e.lesson.embedUrl) ?? entries[0])
		?.lesson.id;
	const [chosenId, setChosenId] = useState<string>();
	const selected =
		entries.find((e) => e.lesson.id === (chosenId ?? defaultId)) ?? entries[0];

	const prompt = useMemo(
		() =>
			selected
				? buildAgentPrompt({
						course,
						lesson: selected.lesson,
						moduleTitle: selected.moduleTitle,
						addresses,
						hasAppSecret,
					})
				: "",
		[course, selected, addresses, hasAppSecret],
	);

	async function loadSkill(): Promise<string | undefined> {
		if (skillText) return skillText;
		try {
			const text = await fetchSkill();
			setSkillText(text);
			setSkillError(false);
			return text;
		} catch {
			setSkillError(true);
			return undefined;
		}
	}

	// Prefetch so the Kimi button can copy and open the tab within the click.
	useEffect(() => {
		fetchSkill()
			.then(setSkillText)
			.catch(() => {});
	}, []);

	async function choose(item: (typeof PLATFORMS)[number]) {
		setPlatform(item.id);
		if (item.id === "claude" || item.id === "chatgpt") {
			download(ZIP_URL, `${SKILL_NAME}.zip`);
		} else if (item.id === "gemini") {
			download(SKILL_URL, "SKILL.md");
		}
		if (item.id === "kimi") {
			// Copy before opening the tab: the clipboard needs this page focused, and
			// the skill is prefetched so the tab opens within the click (no popup block).
			const text = skillText ?? (await loadSkill());
			if (text) {
				void copyText(
					`/skill-creator Creá una skill exactamente con este contenido, sin cambiarlo:\n\n${text}`,
				);
			}
		}
		window.open(item.url, "_blank", "noopener");
	}

	async function copySkill() {
		const text = await loadSkill();
		if (!text) return;
		await copyText(text);
		setSkillCopied(true);
		setTimeout(() => setSkillCopied(false), 2000);
	}

	async function copyPrompt() {
		await copyText(prompt);
		setPromptCopied(true);
		setTimeout(() => setPromptCopied(false), 2000);
	}

	return (
		<section data-section="embed-agent">
			<h2>Crear la app con tu agente de IA</h2>
			<p>
				Agregá la skill a tu IA y mandale el prompt: con los datos de este curso
				arma la actividad, la publica y te devuelve la URL.
			</p>

			<h3>1. Agregá la skill a tu IA</h3>
			<div data-platforms>
				{PLATFORMS.map((item) => (
					<button
						key={item.id}
						type="button"
						aria-pressed={platform === item.id}
						onClick={() => choose(item)}
					>
						{item.label}
					</button>
				))}
			</div>
			{platform && <p data-steps>{STEPS[platform]}</p>}
			<p>
				<small>
					¿Usás un agente de código (Claude Code, Codex, Kimi Code)? Descomprimí
					el .zip en ~/.claude/skills/ o ~/.agents/skills/.
				</small>
			</p>
			<details
				onToggle={(event) => {
					if (event.currentTarget.open) void loadSkill();
				}}
			>
				<summary>Ver la skill para copiarla</summary>
				{skillError && <p>No pudimos cargar la skill. Probá de nuevo.</p>}
				{skillText && (
					<pre>
						<code>{skillText}</code>
					</pre>
				)}
				<p>
					<button type="button" onClick={copySkill}>
						{skillCopied ? "¡Copiado!" : "Copiar skill"}
					</button>{" "}
					<button type="button" onClick={() => download(SKILL_URL, "SKILL.md")}>
						Descargar SKILL.md
					</button>{" "}
					<button
						type="button"
						onClick={() => download(ZIP_URL, `${SKILL_NAME}.zip`)}
					>
						Descargar .zip
					</button>
				</p>
			</details>

			<h3>2. Mandale este prompt</h3>
			{selected ? (
				<>
					<label>
						Clase{" "}
						<select
							value={selected.lesson.id}
							onChange={(event) => setChosenId(event.target.value)}
						>
							{course.modules
								.filter((module) => module.lessons.length > 0)
								.map((module) => (
									<optgroup key={module.id} label={module.title}>
										{module.lessons.map((lesson) => (
											<option key={lesson.id} value={lesson.id}>
												{lesson.title}
											</option>
										))}
									</optgroup>
								))}
						</select>
					</label>
					<pre data-prompt>{prompt}</pre>
					<p>
						<button type="button" onClick={copyPrompt}>
							{promptCopied ? "¡Copiado!" : "Copiar prompt"}
						</button>
					</p>
					<p>
						<small>
							El prompt usa la clase, el puntaje mínimo y la exigencia de
							resultado verificado que tenga cargados la clase. Si los cambiás,
							se actualiza.
						</small>
					</p>
				</>
			) : (
				<p>Agregá una clase para generar el prompt.</p>
			)}

			<h3>3. Pegá la URL</h3>
			<p>Pegá la URL que te devuelva en la clase, en «URL de la app».</p>
		</section>
	);
}

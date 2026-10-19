export const BEGIN_MARKER =
	"-- >>> better-auth generated (do not edit by hand; run `pnpm db:auth`) >>>";
export const END_MARKER = "-- <<< better-auth generated <<<";

function buildSection(generated: string): string {
	return [
		BEGIN_MARKER,
		"CREATE SCHEMA IF NOT EXISTS auth;",
		"SET search_path TO auth;",
		generated.trim(),
		"RESET search_path;",
		END_MARKER,
	].join("\n");
}

export function replaceGeneratedSection(
	content: string,
	generated: string,
): string {
	const section = buildSection(generated);
	const begin = content.indexOf(BEGIN_MARKER);
	const end = content.indexOf(END_MARKER);

	if (begin === -1 && end === -1) {
		const separator = content === "" || content.endsWith("\n") ? "" : "\n";
		return `${content}${separator}${section}\n`;
	}

	if (begin === -1 || end === -1 || end < begin) {
		throw new Error("schema file has a broken generated-section marker");
	}

	return (
		content.slice(0, begin) + section + content.slice(end + END_MARKER.length)
	);
}

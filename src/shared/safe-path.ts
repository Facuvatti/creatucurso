/** A same-site path that is safe to redirect to (never another origin). */
export function safeLocalPath(value: string | null | undefined): string {
	if (!value) return "/";
	if (
		!value.startsWith("/") ||
		value.startsWith("//") ||
		value.includes("\\")
	) {
		return "/";
	}
	return value;
}

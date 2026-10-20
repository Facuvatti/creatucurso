import { MAX_SLUG_LENGTH, slugify } from "../../shared/text/slugify.ts";

export type ImportIssue = { path: string; message: string };

type ImportClass = {
	title: string;
	description?: string;
	order: number;
	videos: string[];
	notes: string[];
};

type ImportModule = {
	title: string;
	description?: string;
	order: number;
	classes: ImportClass[];
};

export type CourseImport = {
	name: string;
	slug: string;
	shortDescription?: string;
	longDescription?: string;
	coverImages: string[];
	promoVideo?: string;
	instructors: string[];
	requirements: string[];
	learningGoals: string[];
	targetStudents: string[];
	modules: ImportModule[];
};

export type ParseCourseImportResult =
	| { ok: true; course: CourseImport }
	| { ok: false; errors: ImportIssue[] };

type Raw = Record<string, unknown>;
type Optional<T> = T & { order?: number };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isBlank = (value: unknown) =>
	value === undefined || (typeof value === "string" && value.trim() === "");

/**
 * Checks the JSON a creator pastes to create a course. Reports every problem
 * at once, each with the path of the offending value.
 */
export function parseCourseImport(input: unknown): ParseCourseImportResult {
	const errors: ImportIssue[] = [];
	const add = (path: string, message: string) =>
		errors.push({ path: path || "$", message });
	const child = (path: string, key: string) => (path ? `${path}.${key}` : key);

	function object(value: unknown, path: string, known: string[]): Raw | null {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			add(path, "must be an object");
			return null;
		}
		const unknown = Object.keys(value).filter((key) => !known.includes(key));
		if (unknown.length > 0) {
			const names = unknown.map((key) => `"${key}"`).join(", ");
			add(path, `Unrecognized key${unknown.length > 1 ? "s" : ""}: ${names}`);
		}
		return value as Raw;
	}

	function required(value: unknown, path: string, max: number): string {
		if (typeof value !== "string") {
			add(path, "must be text");
			return "";
		}
		const trimmed = value.trim();
		if (trimmed === "") add(path, "must not be empty");
		else if (trimmed.length > max)
			add(path, `must have at most ${max} characters`);
		return trimmed;
	}

	function optional(value: unknown, path: string, max: number) {
		if (isBlank(value)) return undefined;
		return required(value, path, max);
	}

	function mediaRef(value: unknown, path: string): string {
		const ref = required(value, path, 1024);
		if ([...ref].some((char) => char.charCodeAt(0) < 32)) {
			add(path, "must not contain control characters");
		}
		return ref;
	}

	/** A list of at most `max` items; `minMessage` makes it mandatory and non-empty. */
	function list<T>(
		value: unknown,
		path: string,
		max: number,
		item: (value: unknown, path: string) => T,
		minMessage?: string,
	): T[] {
		if (value === undefined && !minMessage) return [];
		if (!Array.isArray(value)) {
			add(path, minMessage ?? "must be a list");
			return [];
		}
		if (minMessage && value.length < 1) add(path, minMessage);
		if (value.length > max) add(path, `must have at most ${max} items`);
		return value.map((entry, index) => item(entry, `${path}[${index}]`));
	}

	function order<T extends { order?: number }>(
		raw: Raw,
		path: string,
		entry: T,
	): T {
		const value = raw.order;
		if (value === undefined) return entry;
		if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
			add(child(path, "order"), "must be a positive whole number");
			return entry;
		}
		return { ...entry, order: value };
	}

	function parseClass(value: unknown, path: string): Optional<ImportClass> {
		const raw = object(value, path, [
			"title",
			"description",
			"order",
			"videos",
			"notes",
		]);
		const blank = {
			title: "",
			order: 0,
			videos: [] as string[],
			notes: [] as string[],
		};
		if (!raw) return blank;
		return order(raw, path, {
			title: required(raw.title, child(path, "title"), 150),
			description: optional(raw.description, child(path, "description"), 2000),
			order: 0,
			videos: list(
				raw.videos,
				child(path, "videos"),
				10,
				mediaRef,
				"at least one video is required",
			),
			notes: list(raw.notes, child(path, "notes"), 20, mediaRef),
		});
	}

	function parseModule(value: unknown, path: string): Optional<ImportModule> {
		const raw = object(value, path, [
			"title",
			"description",
			"order",
			"classes",
		]);
		if (!raw) return { title: "", order: 0, classes: [] };
		return order(raw, path, {
			title: required(raw.title, child(path, "title"), 150),
			description: optional(raw.description, child(path, "description"), 2000),
			order: 0,
			classes: list(
				raw.classes,
				child(path, "classes"),
				200,
				parseClass,
				"at least one class is required",
			),
		});
	}

	const raw = object(input, "", [
		"name",
		"slug",
		"shortDescription",
		"longDescription",
		"coverImages",
		"promoVideo",
		"instructors",
		"requirements",
		"learningGoals",
		"targetStudents",
		"modules",
	]);
	if (!raw) return { ok: false, errors };

	const name = required(raw.name, "name", 150);
	let slug: string | undefined;
	if (!isBlank(raw.slug)) {
		if (typeof raw.slug !== "string") add("slug", "must be text");
		else {
			slug = raw.slug.trim();
			if (slug.length > MAX_SLUG_LENGTH) {
				add("slug", `must have at most ${MAX_SLUG_LENGTH} characters`);
			} else if (!SLUG.test(slug)) {
				add("slug", "use lowercase letters, digits and single hyphens");
			}
		}
	}
	const shortDescription = optional(
		raw.shortDescription,
		"shortDescription",
		300,
	);
	const longDescription = optional(
		raw.longDescription,
		"longDescription",
		10_000,
	);
	const coverImages = list(raw.coverImages, "coverImages", 10, mediaRef);
	const promoVideo = isBlank(raw.promoVideo)
		? undefined
		: mediaRef(raw.promoVideo, "promoVideo");
	const text = (value: unknown, path: string) => required(value, path, 200);
	const instructors = list(raw.instructors, "instructors", 20, (v, p) =>
		required(v, p, 64),
	);
	const requirements = list(raw.requirements, "requirements", 30, text);
	const learningGoals = list(raw.learningGoals, "learningGoals", 30, text);
	const targetStudents = list(raw.targetStudents, "targetStudents", 30, text);
	const modules = list(
		raw.modules,
		"modules",
		100,
		parseModule,
		"at least one module is required",
	);

	// The cross-field rules only make sense once every value is well formed.
	if (errors.length === 0) {
		if (!shortDescription && !longDescription) {
			add("shortDescription", "provide a short or a long description");
		}
		if (!slug && slugify(name) === "") {
			add("slug", "a slug could not be generated from the name; provide one");
		}
		checkOrders(modules, "modules", add);
		modules.forEach((module, index) => {
			checkOrders(module.classes, `modules[${index}].classes`, add);
		});
	}
	if (errors.length > 0) return { ok: false, errors };

	return {
		ok: true,
		course: {
			name,
			slug: slug ?? slugify(name),
			shortDescription,
			longDescription,
			coverImages,
			promoVideo,
			instructors,
			requirements,
			learningGoals,
			targetStudents,
			modules: withOrder(modules).map((module) => ({
				...module,
				classes: withOrder(module.classes),
			})),
		},
	};
}

function checkOrders(
	items: { order?: number }[],
	path: string,
	add: (path: string, message: string) => void,
) {
	const seen = new Set<number>();
	items.forEach((item, index) => {
		const effective = item.order || index + 1;
		if (seen.has(effective)) {
			add(
				`${path}[${index}].order`,
				`order ${effective} is already used by a sibling`,
			);
		}
		seen.add(effective);
	});
}

function withOrder<T extends { order?: number }>(items: T[]) {
	return items
		.map((item, index) => ({ ...item, order: item.order || index + 1 }))
		.sort((a, b) => a.order - b.order);
}

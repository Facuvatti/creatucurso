import { z } from "zod";
import { MAX_SLUG_LENGTH, slugify } from "../../../shared/text/slugify.ts";

const blankToUndefined = (value: unknown) =>
	typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
	z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const requiredText = (max: number) =>
	z.string().trim().min(1, "must not be empty").max(max);

const mediaRef = z
	.string()
	.trim()
	.min(1, "must not be empty")
	.max(1024)
	.refine(
		(value) => ![...value].some((char) => char.charCodeAt(0) < 32),
		"must not contain control characters",
	);

const textList = (maxItems: number) =>
	z.array(requiredText(200)).max(maxItems).default([]);

const order = z.number().int().positive().optional();

const classSchema = z.strictObject({
	title: requiredText(150),
	description: optionalText(2000),
	order,
	videos: z.array(mediaRef).min(1, "at least one video is required").max(10),
	notes: z.array(mediaRef).max(20).default([]),
});

const moduleSchema = z.strictObject({
	title: requiredText(150),
	description: optionalText(2000),
	order,
	classes: z
		.array(classSchema)
		.min(1, "at least one class is required")
		.max(200),
});

const slugSchema = z.preprocess(
	blankToUndefined,
	z
		.string()
		.trim()
		.max(MAX_SLUG_LENGTH)
		.regex(
			/^[a-z0-9]+(-[a-z0-9]+)*$/,
			"use lowercase letters, digits and single hyphens",
		)
		.optional(),
);

function checkOrders(
	items: { order?: number | undefined }[],
	path: (string | number)[],
	ctx: z.core.$RefinementCtx,
) {
	const seen = new Set<number>();
	items.forEach((item, index) => {
		const effective = item.order ?? index + 1;
		if (seen.has(effective)) {
			ctx.addIssue({
				code: "custom",
				path: [...path, index, "order"],
				message: `order ${effective} is already used by a sibling`,
			});
		}
		seen.add(effective);
	});
}

function withOrder<T extends { order?: number | undefined }>(items: T[]) {
	return items
		.map((item, index) => ({ ...item, order: item.order ?? index + 1 }))
		.sort((a, b) => a.order - b.order);
}

export const courseImportSchema = z
	.strictObject({
		name: requiredText(150),
		slug: slugSchema,
		shortDescription: optionalText(300),
		longDescription: optionalText(10_000),
		coverImages: z.array(mediaRef).max(10).default([]),
		promoVideo: z.preprocess(blankToUndefined, mediaRef.optional()),
		instructors: z.array(requiredText(64)).max(20).default([]),
		requirements: textList(30),
		learningGoals: textList(30),
		targetStudents: textList(30),
		modules: z
			.array(moduleSchema)
			.min(1, "at least one module is required")
			.max(100),
	})
	.superRefine((course, ctx) => {
		if (!course.shortDescription && !course.longDescription) {
			ctx.addIssue({
				code: "custom",
				path: ["shortDescription"],
				message: "provide a short or a long description",
			});
		}
		if (!course.slug && slugify(course.name) === "") {
			ctx.addIssue({
				code: "custom",
				path: ["slug"],
				message: "a slug could not be generated from the name; provide one",
			});
		}
		checkOrders(course.modules, ["modules"], ctx);
		course.modules.forEach((module, index) => {
			checkOrders(module.classes, ["modules", index, "classes"], ctx);
		});
	})
	.transform((course) => ({
		...course,
		slug: course.slug ?? slugify(course.name),
		modules: withOrder(course.modules).map((module) => ({
			...module,
			classes: withOrder(module.classes),
		})),
	}));

export type CourseImport = z.output<typeof courseImportSchema>;
export type ImportIssue = { path: string; message: string };
export type ParseCourseImportResult =
	| { ok: true; course: CourseImport }
	| { ok: false; errors: ImportIssue[] };

function formatPath(path: PropertyKey[]): string {
	if (path.length === 0) return "$";
	return path.reduce<string>((text, part) => {
		if (typeof part === "number") return `${text}[${part}]`;
		return text === "" ? String(part) : `${text}.${String(part)}`;
	}, "");
}

export function parseCourseImport(input: unknown): ParseCourseImportResult {
	const result = courseImportSchema.safeParse(input);
	if (result.success) return { ok: true, course: result.data };

	return {
		ok: false,
		errors: result.error.issues.map((issue) => ({
			path: formatPath(issue.path),
			message: issue.message,
		})),
	};
}

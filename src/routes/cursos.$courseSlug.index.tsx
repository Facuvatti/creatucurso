import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { ReviewsSection } from "../components/community/reviews-section.tsx";
import { CoursePage } from "../components/pages/course-page.tsx";
import { getCoursePage } from "../server/catalog.functions.ts";
import {
	getCourseReviews,
	setReviewVisibility,
	submitReview,
} from "../server/community.functions.ts";
import {
	enrollInFreeCourse,
	getRefundEligibility,
	requestRefund,
} from "../server/payments.functions.ts";

export const Route = createFileRoute("/cursos/$courseSlug/")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
	},
	loader: async ({ params }) => {
		const [result, reviews, refundable] = await Promise.all([
			getCoursePage({ data: { courseSlug: params.courseSlug } }),
			getCourseReviews({ data: { courseSlug: params.courseSlug } }),
			getRefundEligibility({ data: { courseSlug: params.courseSlug } }),
		]);
		if (result.kind === "notFound") throw notFound();
		if (result.kind === "moved") {
			throw redirect({
				to: "/cursos/$courseSlug",
				params: { courseSlug: result.slug },
				statusCode: 301,
			});
		}
		return { ...result, reviews, refundable };
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: loaderData?.course.name ?? "Curso" },
			...(loaderData?.course.shortDescription
				? [{ name: "description", content: loaderData.course.shortDescription }]
				: []),
		],
	}),
	component: CourseRoute,
});

function CourseRoute() {
	const { course, access, completedLessonIds, reviews, refundable } =
		Route.useLoaderData();
	const { origin, appOrigin } = Route.useRouteContext();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();
	const [reviewMessage, setReviewMessage] = useState<string>();
	const here = `${origin}/cursos/${course.slug}`;
	const loginUrl = `${appOrigin}/login?return=${encodeURIComponent(here)}`;

	return (
		<CoursePage
			course={course}
			access={access}
			completedLessonIds={completedLessonIds}
			loginUrl={loginUrl}
			pending={pending}
			message={message}
			refundable={refundable}
			onRequestRefund={async () => {
				if (
					!window.confirm(
						"¿Querés reembolsar este curso? Vas a perder el acceso.",
					)
				)
					return;
				setPending(true);
				const result = await requestRefund({
					data: { courseSlug: course.slug },
				});
				setPending(false);
				setMessage(result.ok ? "Reembolso realizado." : result.message);
				if (result.ok) await router.invalidate();
			}}
			onEnrollFree={async () => {
				setPending(true);
				const result = await enrollInFreeCourse({
					data: { courseSlug: course.slug },
				});
				setPending(false);
				if (!result.ok) return setMessage(result.message);
				await router.invalidate();
			}}
		>
			{reviews && (
				<ReviewsSection
					data={reviews}
					pending={pending}
					message={reviewMessage}
					onSubmit={async (values) => {
						setPending(true);
						const result = await submitReview({
							data: { courseSlug: course.slug, ...values },
						});
						setPending(false);
						setReviewMessage(
							result.ok ? "¡Gracias por tu reseña!" : result.message,
						);
						if (result.ok) await router.invalidate();
					}}
					onHide={async (reviewId, hidden) => {
						setPending(true);
						await setReviewVisibility({ data: { reviewId, hidden } });
						setPending(false);
						await router.invalidate();
					}}
				/>
			)}
		</CoursePage>
	);
}

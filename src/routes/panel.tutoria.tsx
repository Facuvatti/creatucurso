import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { can } from "../areas/identity/permissions.ts";
import { TutorPanelPage } from "../components/pages/tutor-panel-page.tsx";
import {
	getTutorInbox,
	postComment,
	setCommentFlag,
} from "../server/community.functions.ts";

export const Route = createFileRoute("/panel/tutoria")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/panel/tutoria`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
		// Staff and tutors only (students cannot moderate).
		if (!can(context.roles, { comment: ["moderate"] })) throw notFound();
	},
	loader: () => getTutorInbox(),
	head: () => ({ meta: [{ title: "Tutoría | Panel" }] }),
	component: TutorRoute,
});

function TutorRoute() {
	const items = Route.useLoaderData();
	const { roles } = Route.useRouteContext();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();

	async function run(
		action: () => Promise<{ ok: true } | { ok: false; message: string }>,
	) {
		setPending(true);
		const result = await action();
		setMessage(result.ok ? undefined : result.message);
		if (result.ok) await router.invalidate();
		setPending(false);
	}

	return (
		<TutorPanelPage
			items={items}
			pending={pending}
			message={message}
			isStaff={can(roles, { course: ["update"] })}
			onReply={(item, body) =>
				run(() =>
					postComment({
						data: {
							courseSlug: item.courseSlug,
							lessonSlug: item.lessonSlug,
							parentId: item.threadId,
							body,
						},
					}),
				)
			}
			onAnswered={(item) =>
				run(() =>
					setCommentFlag({
						data: { commentId: item.threadId, flag: "answered", value: true },
					}),
				)
			}
		/>
	);
}

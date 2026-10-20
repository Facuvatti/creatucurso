import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { can } from "../areas/identity/permissions.ts";
import { ModerationPage } from "../components/pages/moderation-page.tsx";
import {
	getModerationQueue,
	moderateReportedComment,
	setStudentMuted,
} from "../server/community.functions.ts";

export const Route = createFileRoute("/panel/moderacion")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/panel/moderacion`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
		// Staff and tutors only (students cannot moderate).
		if (!can(context.roles, { comment: ["moderate"] })) throw notFound();
	},
	loader: () => getModerationQueue(),
	head: () => ({ meta: [{ title: "Moderación | Panel" }] }),
	component: ModerationRoute,
});

function ModerationRoute() {
	const { items, canMute } = Route.useLoaderData();
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
		<ModerationPage
			items={items}
			canMute={canMute}
			pending={pending}
			message={message}
			onDismiss={(item) =>
				run(() =>
					moderateReportedComment({
						data: { commentId: item.id, action: "dismiss" },
					}),
				)
			}
			onDelete={(item) => {
				if (
					!window.confirm(
						"¿Eliminar este comentario? Queda un aviso en su lugar.",
					)
				)
					return;
				return run(() =>
					moderateReportedComment({
						data: { commentId: item.id, action: "delete" },
					}),
				);
			}}
			onMute={(item, muted) =>
				run(() => setStudentMuted({ data: { userId: item.authorId, muted } }))
			}
		/>
	);
}

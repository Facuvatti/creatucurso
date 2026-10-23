import { createServerFn } from "@tanstack/react-start";
import * as chat from "../areas/chat/chat.ts";
import type {
	ChatContact,
	ChatMessage,
	ConversationSummary,
} from "../areas/chat/types.ts";
import { can } from "../areas/identity/permissions.ts";
import { record, text, uuid } from "../shared/validate.ts";
import { requireTenantContext } from "./request.server.ts";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/** A signed-in member of this academy. Each chat call then checks the pair itself (chat.ts). */
async function requireChatUser() {
	const { tenant, user, roles } = await requireTenantContext();
	if (!user || !can(roles, { chat: ["participate"] })) {
		throw new Error("Iniciá sesión para usar los mensajes.");
	}
	return { tenant, user };
}

export type ChatOverview = {
	meId: string;
	conversations: ConversationSummary[];
	contacts: ChatContact[];
};

/** Everything the messages page needs to open. */
export const getChatOverview = createServerFn({ method: "GET" }).handler(
	async (): Promise<ChatOverview> => {
		const { tenant, user } = await requireChatUser();
		const [conversations, contacts] = await Promise.all([
			chat.listConversations(tenant.id, user.id),
			chat.listContacts(tenant.id, user.id, ""),
		]);
		return { meId: user.id, conversations, contacts };
	},
);

/** The people the caller may write to, filtered by name. */
export const searchChatContacts = createServerFn({ method: "GET" })
	.validator((data: unknown) => ({ search: text(record(data), "search", 100) }))
	.handler(async ({ data }): Promise<ChatContact[]> => {
		const { tenant, user } = await requireChatUser();
		return chat.listContacts(tenant.id, user.id, data.search);
	});

/** Finds or creates the conversation with someone for a course. */
export const startChat = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			courseId: uuid(input, "courseId"),
			otherUserId: text(input, "otherUserId", 100, 1),
		};
	})
	.handler(async ({ data }): Promise<Result<{ conversationId: string }>> => {
		const { tenant, user } = await requireChatUser();
		const conversationId = await chat.openConversation(
			tenant.id,
			user.id,
			data.courseId,
			data.otherUserId,
		);
		return conversationId
			? { ok: true, conversationId }
			: { ok: false, message: "No podés escribirle a esta persona." };
	});

export type MessagesPage = { messages: ChatMessage[]; hasMore: boolean };

/** One page of messages (oldest first); `beforeId` loads the page before that message. */
export const getChatMessages = createServerFn({ method: "GET" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			conversationId: uuid(input, "conversationId"),
			beforeId:
				input.beforeId === undefined || input.beforeId === null
					? null
					: uuid(input, "beforeId"),
		};
	})
	.handler(async ({ data }): Promise<Result<MessagesPage>> => {
		const { tenant, user } = await requireChatUser();
		const page = await chat.listMessages(
			tenant.id,
			user.id,
			data.conversationId,
			data.beforeId,
		);
		return page
			? { ok: true, ...page }
			: { ok: false, message: "No tenés acceso a esta conversación." };
	});

/** A text-only message. Messages with a file go through POST /api/chat/send/<conversationId>. */
export const sendChatMessage = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			conversationId: uuid(input, "conversationId"),
			body: text(input, "body", chat.MESSAGE_MAX_LENGTH, 1),
		};
	})
	.handler(async ({ data }): Promise<Result<{ chatMessage: ChatMessage }>> => {
		const { tenant, user } = await requireChatUser();
		const result = await chat.sendMessage(
			tenant.id,
			user.id,
			data.conversationId,
			{ body: data.body },
		);
		return result.ok
			? { ok: true, chatMessage: result.message }
			: { ok: false, message: result.message };
	});

export const markChatRead = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		conversationId: uuid(record(data), "conversationId"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, user } = await requireChatUser();
		const found = await chat.markRead(tenant.id, user.id, data.conversationId);
		return found
			? { ok: true }
			: { ok: false, message: "No tenés acceso a esta conversación." };
	});

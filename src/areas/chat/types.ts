// Plain types shared by the chat service, the server functions and the page.

export type ChatAttachment = {
	name: string;
	type: string;
	/** Authenticated download route; the file is never under a public path. */
	url: string;
};

export type ChatMessage = {
	id: string;
	conversationId: string;
	senderId: string;
	body: string;
	attachment: ChatAttachment | null;
	createdAt: string;
};

export type ConversationSummary = {
	id: string;
	courseId: string;
	courseName: string;
	otherUserId: string;
	otherName: string;
	/** What the other person is in this conversation. */
	otherIs: "student" | "staff";
	lastMessageAt: string;
	lastBody: string;
	lastHasAttachment: boolean;
	unread: number;
};

/** Someone the caller may start a conversation with, for one course. */
export type ChatContact = {
	courseId: string;
	courseName: string;
	userId: string;
	name: string;
	is: "student" | "staff";
};

/** What the server pushes on `GET /api/chat/stream`. */
export type ChatEvent = {
	organizationId: string;
	conversationId: string;
	message: ChatMessage;
};

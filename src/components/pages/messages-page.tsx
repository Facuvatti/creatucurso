import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ChatContact,
	ChatEvent,
	ChatMessage,
	ConversationSummary,
} from "../../areas/chat/types.ts";
import {
	type ChatOverview,
	getChatMessages,
	getChatOverview,
	markChatRead,
	searchChatContacts,
	sendChatMessage,
	startChat,
} from "../../server/chat.functions.ts";

type Props = {
	overview: ChatOverview;
	isStaff: boolean;
	/** Opens (or creates) the conversation with this person for this course on arrival. */
	start?: { courseId: string; userId: string } | undefined;
};

const RECONNECT_MS = 5000;

// Layout only: two columns on a wide screen, one at a time on a phone.
const CSS = `
[data-page="messages"] .chat { display: grid; grid-template-columns: 18rem 1fr; gap: 1rem; min-height: 60vh; }
[data-page="messages"] .chat-list { overflow-y: auto; max-height: 75vh; }
[data-page="messages"] .chat-list ul, [data-page="messages"] .chat-thread ul { list-style: none; padding: 0; margin: 0; }
[data-page="messages"] .chat-thread { display: flex; flex-direction: column; max-height: 75vh; }
[data-page="messages"] .chat-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: .5rem; padding: .5rem 0; }
[data-page="messages"] .chat-bubble { max-width: 85%; padding: .4rem .7rem; border: 1px solid currentColor; border-radius: .6rem; white-space: pre-wrap; overflow-wrap: anywhere; }
[data-page="messages"] .chat-bubble[data-mine="true"] { align-self: flex-end; }
[data-page="messages"] .chat-bubble img { max-width: 100%; height: auto; display: block; }
[data-page="messages"] .chat-composer { display: flex; flex-wrap: wrap; gap: .5rem; align-items: flex-end; }
[data-page="messages"] .chat-composer textarea { flex: 1 1 12rem; }
[data-page="messages"] .chat-back { display: none; }
@media (max-width: 40rem) {
	[data-page="messages"] .chat { grid-template-columns: 1fr; }
	[data-page="messages"] .chat[data-open="true"] .chat-list { display: none; }
	[data-page="messages"] .chat[data-open="false"] .chat-thread { display: none; }
	[data-page="messages"] .chat-back { display: inline; }
}`;

const time = (iso: string) =>
	new Date(iso).toLocaleString("es-AR", {
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});

export function MessagesPage({ overview, isStaff, start }: Props) {
	const meId = overview.meId;
	const [conversations, setConversations] = useState(overview.conversations);
	const [contacts, setContacts] = useState<ChatContact[]>(overview.contacts);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [hasMore, setHasMore] = useState(false);
	const [draft, setDraft] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [fileKey, setFileKey] = useState(0);
	const [sending, setSending] = useState(false);
	const [message, setMessage] = useState<string>();
	const [showNew, setShowNew] = useState(false);
	const [search, setSearch] = useState("");
	const [online, setOnline] = useState(true);
	const activeRef = useRef<string | null>(null);
	const endRef = useRef<HTMLDivElement>(null);
	const knownRef = useRef(new Set<string>());
	useEffect(() => {
		knownRef.current = new Set(conversations.map((c) => c.id));
	}, [conversations]);

	const refreshList = useCallback(async () => {
		const fresh = await getChatOverview();
		setConversations(fresh.conversations);
		setContacts(fresh.contacts);
	}, []);

	const open = useCallback(async (conversationId: string) => {
		activeRef.current = conversationId;
		setActiveId(conversationId);
		setMessages([]);
		setHasMore(false);
		setMessage(undefined);
		const page = await getChatMessages({ data: { conversationId } });
		if (activeRef.current !== conversationId) return;
		if (!page.ok) {
			setMessage(page.message);
			return;
		}
		setMessages(page.messages);
		setHasMore(page.hasMore);
		setConversations((list) =>
			list.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)),
		);
		await markChatRead({ data: { conversationId } });
	}, []);

	// A message arrived on the stream (also the echo of what I sent myself).
	const onEvent = useCallback(
		(event: ChatEvent) => {
			const incoming = event.message;
			const mine = incoming.senderId === meId;
			const isOpen = activeRef.current === event.conversationId;
			if (isOpen) {
				setMessages((list) =>
					list.some((m) => m.id === incoming.id) ? list : [...list, incoming],
				);
				if (!mine) {
					void markChatRead({ data: { conversationId: event.conversationId } });
				}
			}
			setConversations((list) =>
				list
					.map((c) =>
						c.id === event.conversationId
							? {
									...c,
									lastMessageAt: incoming.createdAt,
									lastBody: incoming.body,
									lastHasAttachment: incoming.attachment !== null,
									unread: mine || isOpen ? c.unread : c.unread + 1,
								}
							: c,
					)
					.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
			);
			// A conversation this page has not seen yet: fetch the list.
			if (!knownRef.current.has(event.conversationId)) void refreshList();
		},
		[meId, refreshList],
	);

	// Server-sent events, reconnecting when the connection drops.
	useEffect(() => {
		let source: EventSource | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		let wasDown = false;

		const connect = () => {
			source = new EventSource("/api/chat/stream");
			source.addEventListener("message", (raw) => {
				try {
					onEvent(JSON.parse((raw as MessageEvent<string>).data) as ChatEvent);
				} catch {
					// Ignore a malformed event.
				}
			});
			source.onopen = () => {
				setOnline(true);
				if (wasDown) {
					// Catch up on what arrived while the connection was down.
					wasDown = false;
					void refreshList();
					const current = activeRef.current;
					if (current) void open(current);
				}
			};
			source.onerror = () => {
				setOnline(false);
				wasDown = true;
				// The browser retries by itself unless the server closed the stream for good.
				if (source?.readyState === EventSource.CLOSED && !stopped) {
					source.close();
					timer = setTimeout(connect, RECONNECT_MS);
				}
			};
		};
		connect();
		return () => {
			stopped = true;
			clearTimeout(timer);
			source?.close();
		};
	}, [onEvent, open, refreshList]);

	// Deep link from the tutor inbox: ?curso=<courseId>&con=<userId>.
	const startedRef = useRef(false);
	useEffect(() => {
		if (!start || startedRef.current) return;
		startedRef.current = true;
		void (async () => {
			try {
				const result = await startChat({
					data: { courseId: start.courseId, otherUserId: start.userId },
				});
				if (!result.ok) {
					setMessage(result.message);
					return;
				}
				await refreshList();
				await open(result.conversationId);
			} catch {
				setMessage("No se pudo abrir la conversación.");
			}
		})();
	}, [start, open, refreshList]);

	// Scroll to the newest message when the thread changes.
	const lastId = messages.at(-1)?.id;
	useEffect(() => {
		if (lastId) endRef.current?.scrollIntoView({ block: "end" });
	}, [lastId]);

	async function loadOlder() {
		const first = messages[0];
		if (!activeId || !first) return;
		const page = await getChatMessages({
			data: { conversationId: activeId, beforeId: first.id },
		});
		if (!page.ok) {
			setMessage(page.message);
			return;
		}
		setMessages((list) => [...page.messages, ...list]);
		setHasMore(page.hasMore);
	}

	async function send() {
		if (!activeId || sending) return;
		const body = draft.trim();
		if (!body && !file) return;
		setSending(true);
		setMessage(undefined);
		try {
			let sent: ChatMessage | undefined;
			if (file) {
				const form = new FormData();
				form.set("body", body);
				form.set("file", file);
				const response = await fetch(`/api/chat/send/${activeId}`, {
					method: "POST",
					headers: { "x-chat-upload": "1" },
					body: form,
				});
				const result = (await response.json().catch(() => null)) as
					| { ok: true; message: ChatMessage }
					| { ok: false; message: string }
					| null;
				if (result?.ok) sent = result.message;
				else setMessage(result?.message ?? "No se pudo enviar el archivo.");
			} else {
				const result = await sendChatMessage({
					data: { conversationId: activeId, body },
				});
				if (result.ok) sent = result.chatMessage;
				else setMessage(result.message);
			}
			if (sent) {
				const added = sent;
				setMessages((list) =>
					list.some((m) => m.id === added.id) ? list : [...list, added],
				);
				setDraft("");
				setFile(null);
				setFileKey((n) => n + 1);
			}
		} finally {
			setSending(false);
		}
	}

	async function pick(contact: ChatContact) {
		const result = await startChat({
			data: { courseId: contact.courseId, otherUserId: contact.userId },
		});
		if (!result.ok) {
			setMessage(result.message);
			return;
		}
		setShowNew(false);
		await refreshList();
		await open(result.conversationId);
	}

	const active = conversations.find((c) => c.id === activeId);
	const unreadTotal = conversations.reduce((sum, c) => sum + c.unread, 0);

	return (
		<main data-page="messages">
			<style>{CSS}</style>
			<p>
				<Link to="/">Inicio</Link> {isStaff && <Link to="/panel">Panel</Link>}
			</p>
			<h1>Mensajes{unreadTotal > 0 && <> ({unreadTotal} sin leer)</>}</h1>
			{!online && <output>Reconectando…</output>}
			{message && <output>{message}</output>}

			<div className="chat" data-open={activeId ? "true" : "false"}>
				<section className="chat-list" aria-label="Conversaciones">
					<button type="button" onClick={() => setShowNew((v) => !v)}>
						Nueva conversación
					</button>
					{showNew && (
						<form
							onSubmit={async (event) => {
								event.preventDefault();
								setContacts(await searchChatContacts({ data: { search } }));
							}}
						>
							<input
								type="search"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								maxLength={100}
								placeholder="Buscar por nombre"
							/>
							<button type="submit">Buscar</button>
							{contacts.length === 0 && (
								<p>
									<small>No hay personas disponibles para este curso.</small>
								</p>
							)}
							<ul>
								{contacts.map((c) => (
									<li key={`${c.courseId}:${c.userId}`}>
										<button type="button" onClick={() => void pick(c)}>
											{c.name}
										</button>
										<br />
										<small>
											{c.courseName} · {c.is === "staff" ? "Tutoría" : "Alumno"}
										</small>
									</li>
								))}
							</ul>
						</form>
					)}
					{conversations.length === 0 && !showNew && (
						<p>Todavía no tenés conversaciones.</p>
					)}
					<ul>
						{conversations.map((c: ConversationSummary) => (
							<li key={c.id}>
								<button
									type="button"
									aria-current={c.id === activeId}
									onClick={() => void open(c.id)}
								>
									<strong>{c.otherName}</strong>
									{c.unread > 0 && <mark> {c.unread}</mark>}
									<br />
									<small>
										{c.courseName}
										<br />
										{c.lastHasAttachment && !c.lastBody
											? "Archivo adjunto"
											: c.lastBody.slice(0, 60)}
									</small>
								</button>
							</li>
						))}
					</ul>
				</section>

				<section className="chat-thread" aria-label="Conversación">
					{!active && <p>Elegí una conversación.</p>}
					{active && (
						<>
							<header>
								<button
									type="button"
									className="chat-back"
									onClick={() => {
										activeRef.current = null;
										setActiveId(null);
									}}
								>
									Volver
								</button>{" "}
								<strong>{active.otherName}</strong>{" "}
								<small>
									{active.courseName} ·{" "}
									{active.otherIs === "staff" ? "Tutoría" : "Alumno"}
								</small>
							</header>
							<div className="chat-messages">
								{hasMore && (
									<button type="button" onClick={() => void loadOlder()}>
										Ver mensajes anteriores
									</button>
								)}
								{messages.map((m) => (
									<div
										key={m.id}
										className="chat-bubble"
										data-mine={m.senderId === meId}
									>
										{m.body}
										{m.attachment &&
											(m.attachment.type.startsWith("image/") ? (
												<a
													href={m.attachment.url}
													target="_blank"
													rel="noreferrer"
												>
													<img
														src={m.attachment.url}
														alt={m.attachment.name}
														loading="lazy"
													/>
												</a>
											) : (
												<a href={m.attachment.url} download={m.attachment.name}>
													{m.attachment.name}
												</a>
											))}
										<br />
										<small>{time(m.createdAt)}</small>
									</div>
								))}
								<div ref={endRef} />
							</div>
							<form
								className="chat-composer"
								onSubmit={(event) => {
									event.preventDefault();
									void send();
								}}
							>
								<textarea
									value={draft}
									onChange={(e) => setDraft(e.target.value)}
									maxLength={4000}
									rows={2}
									placeholder="Escribí tu mensaje"
									aria-label="Mensaje"
								/>
								<input
									key={fileKey}
									type="file"
									accept="image/png,image/jpeg,application/pdf"
									onChange={(e) => setFile(e.target.files?.[0] ?? null)}
									aria-label="Adjuntar archivo"
								/>
								<button type="submit" disabled={sending}>
									Enviar
								</button>
							</form>
						</>
					)}
				</section>
			</div>
		</main>
	);
}

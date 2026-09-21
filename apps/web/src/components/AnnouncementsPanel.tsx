"use client";

import { Fragment, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Megaphone, Trash2, Send, Reply, Smile, X } from "lucide-react";
import { Card } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { CurrentUser } from "@/lib/types";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface Author {
  id: string;
  name: string;
  role: string;
}

interface AnnouncementItem {
  id: string;
  authorId: string;
  message: string;
  createdAt: string;
  author: Author | null;
}

interface Announcement extends AnnouncementItem {
  replies: AnnouncementItem[];
}

const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋",
  "😎", "🤩", "🥳", "🤗", "🤔", "😐", "😴", "😢", "😭", "😡", "😱", "🙄", "😬", "🤝", "👍", "👎",
  "👏", "🙌", "🙏", "💪", "👀", "👋", "✌️", "🤞", "❤️", "💛", "💙", "💚", "💜", "🧡", "💔", "🔥",
  "✨", "🎉", "🎊", "🎁", "🏆", "⭐", "💯", "✅", "❌", "⚠️", "📢", "📌", "📅", "⏰", "☕", "🍕",
  "🎂", "🌟", "🌈", "☀️", "🌙", "🚀", "💡", "📝",
];

/** Splits text on "@Full Name" mentions of known users so they can be highlighted. */
function renderWithMentions(text: string, names: string[]) {
  if (names.length === 0) return text;
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="rounded bg-chs-gold/20 px-1 font-semibold text-chs-charcoal">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

/** Text box with @mention autocomplete (scrollable list of everyone) and an emoji picker. */
function Composer({
  users,
  placeholder,
  buttonLabel,
  posting,
  onSubmit,
  autoFocus,
}: {
  users: Author[];
  placeholder: string;
  buttonLabel: string;
  posting: boolean;
  onSubmit: (message: string) => Promise<boolean>;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // "@" followed by the letters typed so far, right before the caret.
  const mention = useMemo(() => {
    const m = /(^|\s)@([^@\n]{0,30})$/.exec(text.slice(0, caret));
    if (!m) return null;
    const query = m[2].toLowerCase();
    const matches = users.filter((u) => u.name.toLowerCase().includes(query));
    if (matches.length === 0) return null;
    return { start: caret - m[2].length - 1, matches };
  }, [text, caret, users]);

  useEffect(() => setActiveIndex(0), [mention?.matches.length, mention?.start]);

  function insertAtCaret(insert: string, replaceFrom?: number) {
    const from = replaceFrom ?? caret;
    const next = text.slice(0, from) + insert + text.slice(caret);
    const pos = from + insert.length;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  function pickMention(u: Author) {
    if (!mention) return;
    insertAtCaret(`@${u.name} `, mention.start);
  }

  async function submit() {
    if (!text.trim() || posting) return;
    const ok = await onSubmit(text.trim());
    if (ok) {
      setText("");
      setCaret(0);
      setShowEmoji(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (mention) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % mention.matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + mention.matches.length) % mention.matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mention.matches[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCaret(0);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            value={text}
            maxLength={2000}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-gray-300 py-2 pl-3 pr-10 text-sm text-chs-charcoal outline-none focus:border-chs-gold focus:ring-1 focus:ring-chs-gold"
          />
          <button
            type="button"
            onClick={() => setShowEmoji((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-chs-gold"
            aria-label="Add emoji"
          >
            <Smile size={18} />
          </button>
        </div>
        <Button onClick={submit} disabled={posting || !text.trim()} size="sm" icon={<Send size={13} />} className="shrink-0">
          {posting ? "Posting..." : buttonLabel}
        </Button>
      </div>

      {mention && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-64 overflow-y-auto rounded-xl border border-gray-100 bg-white py-1 shadow-card">
          {mention.matches.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(u);
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${
                i === activeIndex ? "bg-chs-gold/15" : "hover:bg-chs-bg"
              }`}
            >
              <span className="font-medium text-chs-charcoal">{u.name}</span>
              <span className="text-xs capitalize text-gray-400">{u.role.toLowerCase()}</span>
            </button>
          ))}
        </div>
      )}

      {showEmoji && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-gray-100 bg-white p-2 shadow-card">
          <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertAtCaret(emoji);
                }}
                className="rounded p-1 text-lg hover:bg-chs-bg"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ item }: { item: AnnouncementItem }) {
  return (
    <div className="mt-1 text-xs text-gray-400">
      {item.author?.name ?? "Unknown"} · {new Date(item.createdAt).toLocaleString()}
    </div>
  );
}

/** Dashboard announcements feed — every role can post, reply, @mention and add emoji. */
export function AnnouncementsPanel({ user }: { user: CurrentUser }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [people, setPeople] = useState<Author[]>([]);
  const [posting, setPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const isModerator = user.role === "MANAGER" || user.role === "ADMIN";
  const names = useMemo(() => people.map((p) => p.name), [people]);

  function refresh() {
    apiFetch<{ announcements: Announcement[] }>("/announcements").then(({ announcements }) => setItems(announcements));
  }
  useEffect(() => {
    refresh();
    apiFetch<{ users: Author[] }>("/announcements/mentionable").then(({ users }) => setPeople(users)).catch(() => void 0);
  }, []);

  async function submit(message: string, parentId?: string): Promise<boolean> {
    setPosting(true);
    try {
      await apiFetch("/announcements", { method: "POST", body: JSON.stringify({ message, parentId }) });
      refresh();
      if (parentId) setReplyingTo(null);
      else notifySuccess("Posted", "Your announcement is live on everyone's dashboard.");
      return true;
    } catch (e) {
      notifyError(parentId ? "Couldn't post reply" : "Couldn't post announcement", e instanceof Error ? e.message : undefined);
      return false;
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string, isReply: boolean) {
    const ok = await confirmAction({ title: isReply ? "Delete this reply?" : "Delete this announcement and its replies?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/announcements/${id}`, { method: "DELETE" });
    refresh();
  }

  const canDelete = (item: AnnouncementItem) => isModerator || item.authorId === user.id;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-base font-bold text-chs-charcoal">
        <Megaphone size={18} className="text-chs-gold" />
        Announcements
      </div>

      <div className="mb-4">
        <Composer
          users={people}
          placeholder="Post an update for the whole team... (type @ to mention someone)"
          buttonLabel="Post"
          posting={posting}
          onSubmit={(m) => submit(m)}
        />
      </div>

      <div className="space-y-3">
        {items.length === 0 && <div className="text-sm text-gray-400">No announcements yet.</div>}
        {items.map((a) => (
          <div key={a.id} className="rounded-xl bg-chs-bg px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="break-words text-sm text-chs-charcoal">{renderWithMentions(a.message, names)}</div>
                <Meta item={a} />
              </div>
              {canDelete(a) && (
                <button onClick={() => remove(a.id, false)} className="shrink-0 text-gray-300 hover:text-red-500" aria-label="Delete announcement">
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {a.replies.length > 0 && (
              <div className="mt-3 space-y-2 border-l-2 border-chs-gold/40 pl-3">
                {a.replies.map((r) => (
                  <div key={r.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-sm text-chs-charcoal">{renderWithMentions(r.message, names)}</div>
                      <Meta item={r} />
                    </div>
                    {canDelete(r) && (
                      <button onClick={() => remove(r.id, true)} className="shrink-0 text-gray-300 hover:text-red-500" aria-label="Delete reply">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-2">
              {replyingTo === a.id ? (
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                    <span>Replying to {a.author?.name ?? "this post"}</span>
                    <button onClick={() => setReplyingTo(null)} aria-label="Cancel reply" className="hover:text-red-500">
                      <X size={14} />
                    </button>
                  </div>
                  <Composer
                    autoFocus
                    users={people}
                    placeholder="Write a reply..."
                    buttonLabel="Reply"
                    posting={posting}
                    onSubmit={(m) => submit(m, a.id)}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setReplyingTo(a.id)}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-chs-gold"
                >
                  <Reply size={13} />
                  Reply{a.replies.length > 0 ? ` (${a.replies.length})` : ""}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

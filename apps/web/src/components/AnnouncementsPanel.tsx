"use client";

import { useEffect, useState } from "react";
import { Megaphone, Trash2, Send } from "lucide-react";
import { Card } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { CurrentUser } from "@/lib/types";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface Announcement {
  id: string;
  message: string;
  createdAt: string;
  author: { name: string; role: string } | null;
}

/** Dashboard "Notification from Admin/Manager" feed — post box for Manager/Admin, read feed for everyone. */
export function AnnouncementsPanel({ user }: { user: CurrentUser }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [message, setMessage] = useState("");
  const [posting, setPosting] = useState(false);
  const canPost = user.role === "MANAGER" || user.role === "ADMIN";

  function refresh() {
    apiFetch<{ announcements: Announcement[] }>("/announcements").then(({ announcements }) => setItems(announcements));
  }
  useEffect(refresh, []);

  async function post() {
    if (!message.trim()) return;
    setPosting(true);
    try {
      await apiFetch("/announcements", { method: "POST", body: JSON.stringify({ message: message.trim() }) });
      setMessage("");
      refresh();
      notifySuccess("Posted", "Your announcement is live on everyone's dashboard.");
    } catch (e) {
      notifyError("Couldn't post announcement", e instanceof Error ? e.message : undefined);
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    const ok = await confirmAction({ title: "Delete this announcement?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/announcements/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 text-base font-bold text-chs-charcoal">
        <Megaphone size={18} className="text-chs-gold" />
        Announcements
      </div>

      {canPost && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Post an update for the whole team..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal outline-none focus:border-chs-gold focus:ring-1 focus:ring-chs-gold"
          />
          <Button onClick={post} disabled={posting || !message.trim()} size="sm" icon={<Send size={13} />} className="shrink-0">
            {posting ? "Posting..." : "Post"}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {items.length === 0 && <div className="text-sm text-gray-400">No announcements yet.</div>}
        {items.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl bg-chs-bg px-4 py-3">
            <div>
              <div className="text-sm text-chs-charcoal">{a.message}</div>
              <div className="mt-1 text-xs text-gray-400">
                {a.author?.name ?? "Unknown"} · {new Date(a.createdAt).toLocaleString()}
              </div>
            </div>
            {canPost && (
              <button onClick={() => remove(a.id)} className="shrink-0 text-gray-300 hover:text-red-500" aria-label="Delete announcement">
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

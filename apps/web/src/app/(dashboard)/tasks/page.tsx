"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, ClipboardList, ExternalLink, Pencil, Plus, Save, Trash2, UserPlus } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";
import { Task, TaskStatus, TASK_STATUS_CHOICES, TASK_STATUS_LABEL, TASK_STATUS_TONE, todayIsoDate } from "@/lib/tasks";

type Filter = "ALL" | TaskStatus;
type Editor = { mode: "personal" } | { mode: "assign" } | { mode: "edit"; task: Task };

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal outline-none focus:border-chs-gold";

/** Task Assigned — tasks assigned to me (and ones I add for myself); Managers/Admins also assign and track tasks. */
export default function TasksPage() {
  const { user } = useCurrentUser();
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [assignedTasks, setAssignedTasks] = useState<Task[]>([]);
  const [assignees, setAssignees] = useState<{ id: string; name: string; role: string }[]>([]);
  const [notifications, setNotifications] = useState<{ id: string; message: string; createdAt: string }[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [form, setForm] = useState({ assigneeId: "", subject: "", note: "", link: "", dueDate: todayIsoDate() });
  const [saving, setSaving] = useState(false);

  const isElevated = user?.role === "MANAGER" || user?.role === "ADMIN";

  function refresh() {
    apiFetch<{ tasks: Task[] }>("/tasks/me").then(({ tasks }) => setMyTasks(tasks)).catch(() => void 0);
    apiFetch<{ notifications: typeof notifications }>("/tasks/notifications")
      .then(({ notifications }) => setNotifications(notifications))
      .catch(() => void 0);
    if (isElevated) {
      apiFetch<{ tasks: Task[] }>("/tasks/assigned").then(({ tasks }) => setAssignedTasks(tasks)).catch(() => void 0);
    }
  }

  useEffect(() => {
    if (!user) return;
    refresh();
    if (isElevated) {
      apiFetch<{ users: { id: string; name: string; role: string }[] }>("/tasks/assignees")
        .then(({ users }) => setAssignees(users))
        .catch(() => void 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function openEditor(next: Editor) {
    setEditor(next);
    if (next.mode === "edit") {
      const t = next.task;
      setForm({ assigneeId: t.assigneeId, subject: t.subject, note: t.note ?? "", link: t.link ?? "", dueDate: t.dueDate.slice(0, 10) });
    } else {
      setForm({ assigneeId: assignees[0]?.id ?? "", subject: "", note: "", link: "", dueDate: todayIsoDate() });
    }
  }

  async function save() {
    if (!editor) return;
    setSaving(true);
    try {
      const body = {
        subject: form.subject.trim(),
        note: form.note.trim(),
        link: form.link.trim(),
        dueDate: form.dueDate,
      };
      if (editor.mode === "edit") {
        await apiFetch(`/tasks/${editor.task.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else if (editor.mode === "assign") {
        await apiFetch("/tasks", { method: "POST", body: JSON.stringify({ ...body, assigneeId: form.assigneeId }) });
      } else {
        await apiFetch("/tasks/mine", { method: "POST", body: JSON.stringify(body) });
      }
      setEditor(null);
      refresh();
      notifySuccess(editor.mode === "assign" ? "Task assigned" : editor.mode === "edit" ? "Task updated" : "Task added");
    } catch (e) {
      notifyError("Couldn't save task", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: TaskStatus) {
    try {
      await apiFetch(`/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      refresh();
      notifySuccess("Task updated", TASK_STATUS_LABEL[status]);
    } catch (e) {
      notifyError("Couldn't update task", e instanceof Error ? e.message : undefined);
    }
  }

  async function remove(t: Task) {
    const ok = await confirmAction({ title: `Delete "${t.subject}"?`, danger: true, confirmText: "Delete" });
    if (!ok) return;
    try {
      await apiFetch(`/tasks/${t.id}`, { method: "DELETE" });
      refresh();
      notifySuccess("Task deleted");
    } catch (e) {
      notifyError("Couldn't delete task", e instanceof Error ? e.message : undefined);
    }
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: myTasks.length, ASSIGNED: 0, IN_PROGRESS: 0, FOR_REVIEW: 0, DONE: 0 };
    for (const t of myTasks) c[t.status]++;
    return c;
  }, [myTasks]);

  const visible = useMemo(() => {
    const list = filter === "ALL" ? myTasks : myTasks.filter((t) => t.status === filter);
    // Open tasks first (soonest due), finished ones last.
    return [...list].sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE") || a.dueDate.localeCompare(b.dueDate));
  }, [myTasks, filter]);

  if (!user) return null;

  const today = todayIsoDate();
  const canSave =
    !!form.subject.trim() && !!form.dueDate && (editor?.mode !== "assign" || !!form.assigneeId) && !saving;

  return (
    <div>
      <PageHeader
        title="Task Assigned"
        action={
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus size={16} />} onClick={() => openEditor({ mode: "personal" })}>
              Add my task
            </Button>
            {isElevated && (
              <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => openEditor({ mode: "assign" })} disabled={assignees.length === 0}>
                Assign task
              </Button>
            )}
          </div>
        }
      />

      {notifications.length > 0 && (
        <Card className="mb-6 border border-chs-gold/40 bg-chs-badge/30">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-chs-charcoal">
            <BellRing size={16} className="text-chs-gold" />
            Task notifications
          </div>
          <div className="space-y-1.5">
            {notifications.slice(0, 6).map((n) => (
              <div key={n.id} className="flex flex-col justify-between gap-0.5 text-sm text-chs-charcoal sm:flex-row sm:gap-3">
                <span>{n.message}</span>
                <span className="shrink-0 text-xs text-gray-400">{new Date(n.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-4 flex items-center gap-2 text-base font-bold text-chs-charcoal">
          <ClipboardList size={18} className="text-chs-gold" />
          My tasks
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["ALL", "ASSIGNED", "IN_PROGRESS", "FOR_REVIEW", "DONE"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                filter === f ? "bg-chs-gold text-chs-charcoal" : "bg-chs-bg text-gray-500 hover:text-chs-charcoal"
              }`}
            >
              {f === "ALL" ? "All" : TASK_STATUS_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {visible.length === 0 && (
            <div className="text-sm text-gray-400">
              {myTasks.length === 0 ? "No tasks yet. Tasks assigned to you, and ones you add, will appear here." : "No tasks with this status."}
            </div>
          )}
          {visible.map((t) => {
            const personal = t.assignedBy === t.assigneeId;
            const canEdit = t.assignedBy === user.id || user.role === "ADMIN";
            const overdue = t.status !== "DONE" && t.dueDate.slice(0, 10) < today;
            return (
              <div key={t.id} className="rounded-xl bg-chs-bg px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className={`text-sm font-semibold ${t.status === "DONE" ? "text-gray-400 line-through" : "text-chs-charcoal"}`}>{t.subject}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
                      <span className={overdue ? "font-semibold text-red-500" : ""}>
                        Due {t.dueDate.slice(0, 10)}
                        {overdue ? " · overdue" : ""}
                      </span>
                      <span>·</span>
                      <span>{personal ? "Added by you" : `Assigned by ${t.assignedByName}`}</span>
                    </div>
                    {t.note && <div className="mt-1.5 whitespace-pre-line text-sm text-gray-600">{t.note}</div>}
                    {t.link && (
                      <a href={t.link} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-chs-charcoal hover:underline">
                        <ExternalLink size={12} /> Open link
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <select
                      value={t.status}
                      onChange={(e) => changeStatus(t.id, e.target.value as TaskStatus)}
                      aria-label="Task status"
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-chs-charcoal"
                    >
                      {t.status === "ASSIGNED" && (
                        <option value="ASSIGNED" disabled>
                          Assigned — choose a status
                        </option>
                      )}
                      {TASK_STATUS_CHOICES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    {canEdit && (
                      <>
                        <button onClick={() => openEditor({ mode: "edit", task: t })} className="text-gray-400 hover:text-chs-gold" aria-label="Edit task">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => remove(t)} className="text-gray-400 hover:text-red-500" aria-label="Delete task">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {isElevated && (
        <Card className="mt-6">
          <div className="mb-1 flex items-center gap-2 text-base font-bold text-chs-charcoal">
            <UserPlus size={18} className="text-chs-gold" />
            {user.role === "ADMIN" ? "Tasks assigned to staff" : "Tasks I assigned to my team"}
          </div>
          <div className="mb-4 text-xs text-gray-400">Follow each task&apos;s progress. You&apos;re notified when someone changes its status.</div>
          <div className="space-y-2">
            {assignedTasks.length === 0 && <div className="text-sm text-gray-400">No tasks assigned yet. Use “Assign task” to give one to an employee.</div>}
            {assignedTasks.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-3 rounded-xl bg-chs-bg px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-chs-charcoal">{t.subject}</div>
                  <div className="text-xs text-gray-400">
                    {t.assigneeName} · due {t.dueDate.slice(0, 10)}
                    {user.role === "ADMIN" ? ` · assigned by ${t.assignedByName}` : ""}
                  </div>
                  {t.note && <div className="mt-1 whitespace-pre-line text-xs text-gray-500">{t.note}</div>}
                  {t.link && (
                    <a href={t.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-chs-charcoal hover:underline">
                      <ExternalLink size={11} /> Open link
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={TASK_STATUS_TONE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>
                  {(t.assignedBy === user.id || user.role === "ADMIN") && (
                    <>
                      <button onClick={() => openEditor({ mode: "edit", task: t })} className="text-gray-400 hover:text-chs-gold" aria-label="Edit task">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => remove(t)} className="text-gray-300 hover:text-red-500" aria-label="Delete task">
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {editor && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">
              {editor.mode === "assign" ? "Assign a task" : editor.mode === "edit" ? "Edit task" : "Add my task"}
            </div>
            <div className="mt-4 space-y-3">
              {editor.mode === "assign" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-chs-charcoal">Employee</label>
                  <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} className={INPUT}>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Task subject</label>
                <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={200} className={INPUT} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Note</label>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} maxLength={2000} className={INPUT} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Link</label>
                <input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://..." className={INPUT} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Date (shows on the calendar)</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={INPUT} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button icon={<Save size={14} />} onClick={save} disabled={!canSave}>
                {saving ? "Saving..." : editor.mode === "assign" ? "Assign task" : "Save"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

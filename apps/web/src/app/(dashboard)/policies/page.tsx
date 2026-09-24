"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Trash2, Plus, Check, Save } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface Policy {
  id: string;
  title: string;
  description: string | null;
  linkUrl: string | null;
  version: string;
  owner: string;
  category: string;
  effectiveDate: string;
  acknowledgementRequired: boolean;
  acknowledgedByMe: boolean;
}

export default function PoliciesPage() {
  const { user } = useCurrentUser();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [saving, setSaving] = useState(false);

  function refresh() {
    apiFetch<{ policies: Policy[] }>("/policies").then(({ policies }) => setPolicies(policies));
  }

  useEffect(refresh, []);

  async function openPolicy(p: Policy) {
    if (p.linkUrl) {
      window.open(p.linkUrl, "_blank", "noreferrer");
      return;
    }
    setOpenId(p.id);
    const { fileUrl } = await apiFetch<{ fileUrl: string | null }>(`/policies/${p.id}`);
    setFileUrl(fileUrl);
  }

  async function acknowledge(id: string) {
    await apiFetch(`/policies/${id}/acknowledge`, { method: "POST" });
    refresh();
  }

  async function addPolicy() {
    if (!title.trim() || !linkUrl.trim()) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("description", description.trim());
      form.append("linkUrl", linkUrl.trim());
      const { API_URL } = await import("@/lib/api");
      const res = await fetch(`${API_URL}/policies`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to add policy");
      setShowAdd(false);
      setTitle("");
      setDescription("");
      setLinkUrl("");
      refresh();
      notifySuccess("Policy added");
    } catch (e) {
      notifyError("Couldn't add policy", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function removePolicy(id: string) {
    const ok = await confirmAction({ title: "Delete this policy?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/policies/${id}`, { method: "DELETE" });
    refresh();
    notifySuccess("Policy deleted");
  }

  if (!user) return null;

  const grouped = policies.reduce<Record<string, Policy[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Policies & Templates"
        action={
          <Button icon={<Plus size={16} />} onClick={() => setShowAdd(true)}>
            Add policy
          </Button>
        }
      />

      {policies.length === 0 && (
        <Card className="mb-6">
          <div className="text-sm text-gray-400">No policies published yet.</div>
        </Card>
      )}

      {Object.entries(grouped).map(([category, items]) => (
        <Card key={category} className="mb-6">
          <div className="mb-4 text-base font-bold text-chs-charcoal">{category.replace("_", " ")}</div>
          <div className="divide-y divide-gray-50">
            {items.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <button
                    onClick={() => openPolicy(p)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-chs-charcoal hover:underline"
                  >
                    {p.title}
                    {p.linkUrl && <ExternalLink size={13} className="text-gray-400" />}
                  </button>
                  {p.description && <div className="text-xs text-gray-500">{p.description}</div>}
                  <div className="text-xs text-gray-400">
                    Owner: {p.owner} · Effective {p.effectiveDate.slice(0, 10)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {user.role !== "ADMIN" && p.acknowledgementRequired && (
                    <Badge tone={p.acknowledgedByMe ? "green" : "gold"}>
                      {p.acknowledgedByMe ? "Acknowledged" : "Ack. required"}
                    </Badge>
                  )}
                  {user.role !== "ADMIN" && p.acknowledgementRequired && !p.acknowledgedByMe && (
                    <Button size="sm" variant="success" icon={<Check size={13} />} onClick={() => acknowledge(p.id)}>
                      Acknowledge
                    </Button>
                  )}
                  <button onClick={() => removePolicy(p.id)} className="text-gray-300 hover:text-red-500" aria-label="Delete policy">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {openId && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-md">
            <div className="text-base font-bold text-chs-charcoal">
              {policies.find((p) => p.id === openId)?.title}
            </div>
            <p className="mt-2 text-sm text-gray-500">
              {fileUrl
                ? "Open the secured, time-limited link below to view this document."
                : "No file has been uploaded for this policy yet."}
            </p>
            {fileUrl && (
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block rounded-full bg-chs-gold px-4 py-2 text-sm font-semibold text-chs-charcoal hover:opacity-90"
              >
                Open document
              </a>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" onClick={() => setOpenId(null)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Add policy or template</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal outline-none focus:border-chs-gold"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Short description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal outline-none focus:border-chs-gold"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">SharePoint link</label>
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://cyberhealth.sharepoint.com/..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal outline-none focus:border-chs-gold"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button icon={<Save size={14} />} onClick={addPolicy} disabled={saving || !title.trim() || !linkUrl.trim()}>
                {saving ? "Saving..." : "Add policy"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

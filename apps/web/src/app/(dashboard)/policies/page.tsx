"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Folder, FolderOpen, Link2, Pencil, Plus, Save, Trash2, Upload, Check } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch, API_URL } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface PolicyItem {
  id: string;
  policyId: string;
  title: string;
  description: string | null;
  linkUrl: string | null;
  hasFile: boolean;
  fileName: string | null;
}
interface Policy {
  id: string;
  title: string;
  description: string | null;
  acknowledgementRequired: boolean;
  acknowledgedByMe: boolean;
  items: PolicyItem[];
}

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal outline-none focus:border-chs-gold";

/** Policies & Templates — every policy title is its own folder holding its documents (links or files). */
export default function PoliciesPage() {
  const { user } = useCurrentUser();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [showAddFolder, setShowAddFolder] = useState(false);
  const [folderTitle, setFolderTitle] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [editingFolder, setEditingFolder] = useState<Policy | null>(null);

  const [itemFolderId, setItemFolderId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PolicyItem | null>(null);
  const [itemMode, setItemMode] = useState<"link" | "file">("link");
  const [itemTitle, setItemTitle] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemLink, setItemLink] = useState("");
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function refresh() {
    apiFetch<{ policies: Policy[] }>("/policies").then(({ policies }) => setPolicies(policies));
  }
  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function addFolder() {
    if (!folderTitle.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/policies", { method: "POST", body: JSON.stringify({ title: folderTitle.trim(), description: folderDescription.trim() }) });
      setShowAddFolder(false);
      setFolderTitle("");
      setFolderDescription("");
      refresh();
      notifySuccess("Folder created");
    } catch (e) {
      notifyError("Couldn't create folder", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function saveFolderEdit() {
    if (!editingFolder || !editingFolder.title.trim()) return;
    try {
      await apiFetch(`/policies/${editingFolder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: editingFolder.title.trim(), description: editingFolder.description ?? "" }),
      });
      setEditingFolder(null);
      refresh();
      notifySuccess("Folder updated");
    } catch (e) {
      notifyError("Couldn't update folder", e instanceof Error ? e.message : undefined);
    }
  }

  async function removeFolder(p: Policy) {
    const ok = await confirmAction({
      title: `Delete the "${p.title}" folder?`,
      text: p.items.length ? `This also deletes the ${p.items.length} document${p.items.length === 1 ? "" : "s"} inside it.` : undefined,
      danger: true,
      confirmText: "Delete",
    });
    if (!ok) return;
    await apiFetch(`/policies/${p.id}`, { method: "DELETE" });
    refresh();
    notifySuccess("Folder deleted");
  }

  function openItemForm(policyId: string, item?: PolicyItem) {
    setItemFolderId(policyId);
    setEditingItem(item ?? null);
    setItemMode(item && item.hasFile ? "file" : "link");
    setItemTitle(item?.title ?? "");
    setItemDescription(item?.description ?? "");
    setItemLink(item?.linkUrl ?? "");
    setItemFile(null);
    setExpanded((prev) => ({ ...prev, [policyId]: true }));
  }

  function closeItemForm() {
    setItemFolderId(null);
    setEditingItem(null);
    setItemFile(null);
  }

  async function saveItem() {
    if (!itemFolderId || !itemTitle.trim()) return;
    setSaving(true);
    try {
      if (editingItem) {
        await apiFetch(`/policies/${itemFolderId}/items/${editingItem.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: itemTitle.trim(),
            description: itemDescription.trim(),
            ...(editingItem.hasFile ? {} : { linkUrl: itemLink.trim() }),
          }),
        });
      } else {
        const form = new FormData();
        form.append("title", itemTitle.trim());
        form.append("description", itemDescription.trim());
        if (itemMode === "file" && itemFile) form.append("file", itemFile);
        else form.append("linkUrl", itemLink.trim());
        const res = await fetch(`${API_URL}/policies/${itemFolderId}/items`, { method: "POST", credentials: "include", body: form });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to add document");
      }
      closeItemForm();
      refresh();
      notifySuccess(editingItem ? "Document updated" : "Document added");
    } catch (e) {
      notifyError("Couldn't save document", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(policyId: string, item: PolicyItem) {
    const ok = await confirmAction({ title: `Delete "${item.title}"?`, danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/policies/${policyId}/items/${item.id}`, { method: "DELETE" });
    refresh();
    notifySuccess("Document deleted");
  }

  async function openItem(policyId: string, item: PolicyItem) {
    if (item.linkUrl) {
      window.open(item.linkUrl, "_blank", "noreferrer");
      return;
    }
    try {
      const { fileUrl } = await apiFetch<{ fileUrl: string }>(`/policies/${policyId}/items/${item.id}/file`);
      window.open(fileUrl, "_blank", "noreferrer");
    } catch (e) {
      notifyError("Couldn't open document", e instanceof Error ? e.message : undefined);
    }
  }

  async function acknowledge(id: string) {
    await apiFetch(`/policies/${id}/acknowledge`, { method: "POST" });
    refresh();
  }

  if (!user) return null;

  const canSaveItem =
    !!itemTitle.trim() && (editingItem ? (editingItem.hasFile ? true : !!itemLink.trim()) : itemMode === "file" ? !!itemFile : !!itemLink.trim());

  return (
    <div>
      <PageHeader
        title="Policies & Templates"
        action={
          <Button icon={<Plus size={16} />} onClick={() => setShowAddFolder(true)}>
            Add folder
          </Button>
        }
      />

      <div className="space-y-4">
        {policies.map((p) => {
          const isOpen = expanded[p.id] ?? false;
          return (
            <Card key={p.id}>
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => setExpanded((prev) => ({ ...prev, [p.id]: !isOpen }))} className="flex min-w-0 items-center gap-2 text-left">
                  {isOpen ? <ChevronDown size={16} className="shrink-0 text-gray-400" /> : <ChevronRight size={16} className="shrink-0 text-gray-400" />}
                  {isOpen ? <FolderOpen size={20} className="shrink-0 text-chs-gold" /> : <Folder size={20} className="shrink-0 text-chs-gold" />}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-chs-charcoal">{p.title}</div>
                    <div className="text-xs text-gray-400">
                      {p.items.length} document{p.items.length === 1 ? "" : "s"}
                      {p.description ? ` · ${p.description}` : ""}
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  {user.role !== "ADMIN" && p.acknowledgementRequired && (
                    <Badge tone={p.acknowledgedByMe ? "green" : "gold"}>{p.acknowledgedByMe ? "Acknowledged" : "Ack. required"}</Badge>
                  )}
                  {user.role !== "ADMIN" && p.acknowledgementRequired && !p.acknowledgedByMe && (
                    <Button size="sm" variant="success" icon={<Check size={13} />} onClick={() => acknowledge(p.id)}>
                      Acknowledge
                    </Button>
                  )}
                  <button onClick={() => setEditingFolder(p)} className="text-gray-400 hover:text-chs-gold" aria-label="Edit folder">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => removeFolder(p)} className="text-gray-400 hover:text-red-500" aria-label="Delete folder">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-4 border-t border-gray-50 pt-4">
                  <div className="space-y-2">
                    {p.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-chs-bg px-4 py-2.5">
                        <div className="min-w-0">
                          <button onClick={() => openItem(p.id, item)} className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-chs-charcoal hover:underline">
                            {item.hasFile ? <FileText size={14} className="shrink-0 text-gray-400" /> : <Link2 size={14} className="shrink-0 text-gray-400" />}
                            <span className="truncate">{item.title}</span>
                            <ExternalLink size={12} className="shrink-0 text-gray-400" />
                          </button>
                          {(item.description || item.fileName) && (
                            <div className="truncate text-xs text-gray-400">{item.description || item.fileName}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <button onClick={() => openItemForm(p.id, item)} className="text-gray-400 hover:text-chs-gold" aria-label="Edit document">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => removeItem(p.id, item)} className="text-gray-400 hover:text-red-500" aria-label="Delete document">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {p.items.length === 0 && <div className="text-sm text-gray-400">No documents in this folder yet.</div>}
                  </div>
                  <Button size="sm" variant="secondary" icon={<Plus size={14} />} className="mt-3" onClick={() => openItemForm(p.id)}>
                    Add document
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
        {policies.length === 0 && (
          <Card>
            <div className="text-sm text-gray-400">No policy folders yet. Use “Add folder” to create one.</div>
          </Card>
        )}
      </div>

      {showAddFolder && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Add policy folder</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Folder title</label>
                <input value={folderTitle} onChange={(e) => setFolderTitle(e.target.value)} placeholder="e.g. Code of Conduct" className={INPUT} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Short description</label>
                <textarea value={folderDescription} onChange={(e) => setFolderDescription(e.target.value)} rows={2} className={INPUT} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAddFolder(false)}>Cancel</Button>
              <Button icon={<Plus size={14} />} onClick={addFolder} disabled={saving || !folderTitle.trim()}>
                {saving ? "Saving..." : "Create folder"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {editingFolder && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Edit folder</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Folder title</label>
                <input value={editingFolder.title} onChange={(e) => setEditingFolder({ ...editingFolder, title: e.target.value })} className={INPUT} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Short description</label>
                <textarea value={editingFolder.description ?? ""} onChange={(e) => setEditingFolder({ ...editingFolder, description: e.target.value })} rows={2} className={INPUT} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingFolder(null)}>Cancel</Button>
              <Button icon={<Save size={14} />} onClick={saveFolderEdit} disabled={!editingFolder.title.trim()}>Save changes</Button>
            </div>
          </Card>
        </div>
      )}

      {itemFolderId && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">{editingItem ? "Edit document" : "Add document"}</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Title</label>
                <input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Short description</label>
                <textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} rows={2} className={INPUT} />
              </div>

              {!editingItem && (
                <div className="flex gap-2">
                  {(["link", "file"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setItemMode(m)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${
                        itemMode === m ? "border-chs-gold bg-chs-gold/10 text-chs-charcoal" : "border-gray-200 text-gray-400 hover:text-chs-charcoal"
                      }`}
                    >
                      {m === "link" ? <Link2 size={14} /> : <Upload size={14} />}
                      {m === "link" ? "Link" : "Upload file"}
                    </button>
                  ))}
                </div>
              )}

              {(editingItem ? !editingItem.hasFile : itemMode === "link") ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-chs-charcoal">SharePoint link</label>
                  <input value={itemLink} onChange={(e) => setItemLink(e.target.value)} placeholder="https://cyberhealth.sharepoint.com/..." className={INPUT} />
                </div>
              ) : editingItem ? (
                <div className="text-xs text-gray-400">File: {editingItem.fileName}</div>
              ) : (
                <div>
                  <input ref={fileInput} type="file" className="hidden" onChange={(e) => setItemFile(e.target.files?.[0] ?? null)} />
                  <Button size="sm" variant="secondary" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
                    {itemFile ? "Choose a different file" : "Choose file"}
                  </Button>
                  {itemFile && <div className="mt-2 truncate text-xs text-gray-500">{itemFile.name}</div>}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={closeItemForm}>Cancel</Button>
              <Button icon={<Save size={14} />} onClick={saveItem} disabled={saving || !canSaveItem}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

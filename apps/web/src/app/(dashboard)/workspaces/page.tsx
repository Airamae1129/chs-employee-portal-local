"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, FileText, Folder, FolderOpen, KeyRound, Link2, Lock, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch, API_URL } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface WorkspaceItem {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  linkUrl: string | null;
  hasFile: boolean;
  fileName: string | null;
}
interface Workspace {
  id: string;
  clientName: string;
  description: string | null;
  hasAccess: boolean;
  myAccessRequest: { id: string; status: "REQUESTED" | "APPROVED" | "REJECTED" } | null;
  items: WorkspaceItem[];
}
interface AccessRequest {
  id: string;
  requestedAt: string;
  workspace?: { clientName: string };
  user?: { name: string; email: string };
}

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal";

/**
 * Client Workspaces — one folder per client, each holding that client's
 * documents (links or files). Roles table: everyone sees the client list
 * but only opens links for clients they're assigned to (request access →
 * approved by a Manager assigned to that client, or an Admin); only Admin
 * adds, edits or deletes clients and links.
 */
export default function WorkspacesPage() {
  const { user } = useCurrentUser();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [showAddClient, setShowAddClient] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientDescription, setClientDescription] = useState("");
  const [editingClient, setEditingClient] = useState<Workspace | null>(null);

  const [itemFormFor, setItemFormFor] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<WorkspaceItem | null>(null);
  const [itemMode, setItemMode] = useState<"link" | "file">("link");
  const [itemTitle, setItemTitle] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemLink, setItemLink] = useState("");
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const canManage = user?.role === "ADMIN";
  const canApprove = user?.role === "MANAGER" || user?.role === "ADMIN";
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);

  function refresh() {
    apiFetch<{ workspaces: Workspace[] }>("/workspaces").then(({ workspaces }) => setWorkspaces(workspaces));
    if (canApprove) {
      apiFetch<{ requests: AccessRequest[] }>("/workspaces/requests/pending").then(({ requests }) => setAccessRequests(requests)).catch(() => void 0);
    }
  }

  async function requestAccess(w: Workspace) {
    try {
      await apiFetch(`/workspaces/${w.id}/request-access`, { method: "POST" });
      refresh();
      notifySuccess("Access requested", `A Manager assigned to ${w.clientName} or an Admin will review it.`);
    } catch (e) {
      notifyError("Couldn't request access", e instanceof Error ? e.message : undefined);
    }
  }

  async function decideAccess(r: AccessRequest, decision: "APPROVED" | "REJECTED") {
    const ok = await confirmAction({
      title: `${decision === "APPROVED" ? "Approve" : "Reject"} ${r.user?.name ?? "this"} access to ${r.workspace?.clientName ?? "this client"}?`,
      confirmText: decision === "APPROVED" ? "Approve" : "Reject",
      danger: decision === "REJECTED",
    });
    if (!ok) return;
    try {
      await apiFetch(`/workspaces/requests/${r.id}/decision`, { method: "PATCH", body: JSON.stringify({ decision }) });
      refresh();
      notifySuccess(decision === "APPROVED" ? "Access granted" : "Request rejected");
    } catch (e) {
      notifyError("Couldn't save decision", e instanceof Error ? e.message : undefined);
    }
  }
  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function addClient() {
    if (!clientName.trim()) return;
    try {
      await apiFetch("/workspaces", {
        method: "POST",
        body: JSON.stringify({ clientName: clientName.trim(), description: clientDescription.trim() }),
      });
      setShowAddClient(false);
      setClientName("");
      setClientDescription("");
      refresh();
      notifySuccess("Client folder created");
    } catch (e) {
      notifyError("Couldn't add client", e instanceof Error ? e.message : undefined);
    }
  }

  async function saveClientEdit() {
    if (!editingClient) return;
    await apiFetch(`/workspaces/${editingClient.id}`, {
      method: "PATCH",
      body: JSON.stringify({ clientName: editingClient.clientName, description: editingClient.description ?? "" }),
    });
    setEditingClient(null);
    refresh();
    notifySuccess("Client updated");
  }

  async function removeClient(w: Workspace) {
    const ok = await confirmAction({
      title: `Delete the "${w.clientName}" folder?`,
      text: w.items.length ? `This also deletes the ${w.items.length} document${w.items.length === 1 ? "" : "s"} inside it.` : undefined,
      danger: true,
      confirmText: "Delete",
    });
    if (!ok) return;
    await apiFetch(`/workspaces/${w.id}`, { method: "DELETE" });
    refresh();
    notifySuccess("Client folder deleted");
  }

  function openItemForm(workspaceId: string, item?: WorkspaceItem) {
    setItemFormFor(workspaceId);
    setEditingItem(item ?? null);
    setItemMode(item?.hasFile ? "file" : "link");
    setItemTitle(item?.title ?? "");
    setItemDescription(item?.description ?? "");
    setItemLink(item?.linkUrl ?? "");
    setItemFile(null);
    setExpanded((prev) => ({ ...prev, [workspaceId]: true }));
  }

  function closeItemForm() {
    setItemFormFor(null);
    setEditingItem(null);
    setItemFile(null);
  }

  async function saveItem() {
    if (!itemFormFor || !itemTitle.trim()) return;
    setSaving(true);
    try {
      if (editingItem) {
        await apiFetch(`/workspaces/${itemFormFor}/items/${editingItem.id}`, {
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
        const res = await fetch(`${API_URL}/workspaces/${itemFormFor}/items`, { method: "POST", credentials: "include", body: form });
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

  async function removeItem(workspaceId: string, item: WorkspaceItem) {
    const ok = await confirmAction({ title: `Delete "${item.title}"?`, danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/workspaces/${workspaceId}/items/${item.id}`, { method: "DELETE" });
    refresh();
    notifySuccess("Document deleted");
  }

  async function openItem(workspaceId: string, item: WorkspaceItem) {
    if (item.linkUrl) {
      window.open(item.linkUrl, "_blank", "noreferrer");
      return;
    }
    try {
      const { fileUrl } = await apiFetch<{ fileUrl: string }>(`/workspaces/${workspaceId}/items/${item.id}/file`);
      window.open(fileUrl, "_blank", "noreferrer");
    } catch (e) {
      notifyError("Couldn't open document", e instanceof Error ? e.message : undefined);
    }
  }

  if (!user) return null;

  const canSaveItem =
    !!itemTitle.trim() && (editingItem ? (editingItem.hasFile ? true : !!itemLink.trim()) : itemMode === "file" ? !!itemFile : !!itemLink.trim());

  return (
    <div>
      <PageHeader title="Client Workspaces" />

      {canManage && (
        <div className="mb-6">
          <Button icon={<Plus size={16} />} onClick={() => setShowAddClient(true)}>
            Add Client
          </Button>
        </div>
      )}

      {canApprove && accessRequests.length > 0 && (
        <Card className="mb-6">
          <div className="mb-1 flex items-center gap-2 text-base font-bold text-chs-charcoal">
            <KeyRound size={16} className="text-chs-gold" />
            Access requests to approve
          </div>
          <p className="mb-4 text-xs text-gray-400">
            {user.role === "MANAGER" ? "For clients you're assigned to." : "For every client."} Your own requests are approved by someone else.
          </p>
          <div className="space-y-2">
            {accessRequests.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 rounded-lg bg-chs-bg px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="font-medium text-chs-charcoal">{r.user?.name}</span>
                  <span className="text-gray-500"> wants access to </span>
                  <span className="font-medium text-chs-charcoal">{r.workspace?.clientName}</span>
                  <div className="text-xs text-gray-400">{new Date(r.requestedAt).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="success" icon={<Check size={12} />} onClick={() => decideAccess(r, "APPROVED")}>
                    Approve
                  </Button>
                  <Button size="sm" variant="destructive" icon={<X size={12} />} onClick={() => decideAccess(r, "REJECTED")}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {workspaces.map((w) => {
          const isOpen = (expanded[w.id] ?? false) && w.hasAccess;
          const req = w.myAccessRequest;
          return (
            <Card key={w.id}>
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => w.hasAccess && setExpanded((prev) => ({ ...prev, [w.id]: !isOpen }))}
                  className={`flex min-w-0 items-center gap-2 text-left ${w.hasAccess ? "" : "cursor-default"}`}
                >
                  {!w.hasAccess ? (
                    <Lock size={16} className="shrink-0 text-gray-300" />
                  ) : isOpen ? (
                    <ChevronDown size={16} className="shrink-0 text-gray-400" />
                  ) : (
                    <ChevronRight size={16} className="shrink-0 text-gray-400" />
                  )}
                  {isOpen ? <FolderOpen size={20} className="shrink-0 text-chs-gold" /> : <Folder size={20} className="shrink-0 text-chs-gold" />}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-chs-charcoal">{w.clientName}</div>
                    <div className="text-xs text-gray-400">
                      {w.hasAccess ? `${w.items.length} document${w.items.length === 1 ? "" : "s"}` : "Not assigned"}
                      {w.description ? ` · ${w.description}` : ""}
                    </div>
                  </div>
                </button>
                {!w.hasAccess && (
                  <div className="flex shrink-0 items-center gap-2">
                    {req?.status === "REQUESTED" ? (
                      <Badge tone="gold">Access requested</Badge>
                    ) : (
                      <>
                        {req?.status === "REJECTED" && <Badge tone="red">Rejected</Badge>}
                        <Button size="sm" variant="secondary" icon={<KeyRound size={12} />} onClick={() => requestAccess(w)}>
                          {req?.status === "REJECTED" ? "Request again" : "Request access"}
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {canManage && (
                  <div className="flex shrink-0 items-center gap-3">
                    <button onClick={() => setEditingClient(w)} className="text-gray-400 hover:text-chs-gold" aria-label="Edit client">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => removeClient(w)} className="text-gray-400 hover:text-red-500" aria-label="Remove client">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="mt-4 border-t border-gray-50 pt-4">
                  <div className="space-y-2">
                    {w.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-chs-bg px-4 py-2.5">
                        <div className="min-w-0">
                          <button onClick={() => openItem(w.id, item)} className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-chs-charcoal hover:underline">
                            {item.hasFile ? <FileText size={14} className="shrink-0 text-gray-400" /> : <Link2 size={14} className="shrink-0 text-gray-400" />}
                            <span className="truncate">{item.title}</span>
                            <ExternalLink size={12} className="shrink-0 text-gray-400" />
                          </button>
                          {(item.description || item.fileName) && <div className="truncate text-xs text-gray-400">{item.description || item.fileName}</div>}
                        </div>
                        {canManage && (
                          <div className="flex shrink-0 items-center gap-3">
                            <button onClick={() => openItemForm(w.id, item)} className="text-gray-400 hover:text-chs-gold" aria-label="Edit document">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => removeItem(w.id, item)} className="text-gray-400 hover:text-red-500" aria-label="Delete document">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {w.items.length === 0 && <div className="text-sm text-gray-400">No documents in this folder yet.</div>}
                  </div>
                  {canManage && (
                    <Button size="sm" variant="secondary" icon={<Plus size={14} />} className="mt-3" onClick={() => openItemForm(w.id)}>
                      Add document
                    </Button>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {workspaces.length === 0 && (
          <Card>
            <div className="text-sm text-gray-400">No client folders yet.</div>
          </Card>
        )}
      </div>

      {showAddClient && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Add client folder</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Client name</label>
                <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Description</label>
                <textarea value={clientDescription} onChange={(e) => setClientDescription(e.target.value)} rows={2} className={INPUT} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAddClient(false)}>Cancel</Button>
              <Button icon={<Plus size={14} />} onClick={addClient} disabled={!clientName.trim()}>Create folder</Button>
            </div>
          </Card>
        </div>
      )}

      {editingClient && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Edit client</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Client name</label>
                <input value={editingClient.clientName} onChange={(e) => setEditingClient({ ...editingClient, clientName: e.target.value })} className={INPUT} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Description</label>
                <textarea value={editingClient.description ?? ""} onChange={(e) => setEditingClient({ ...editingClient, description: e.target.value })} rows={2} className={INPUT} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingClient(null)}>Cancel</Button>
              <Button icon={<Save size={14} />} onClick={saveClientEdit}>Save changes</Button>
            </div>
          </Card>
        </div>
      )}

      {itemFormFor && (
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

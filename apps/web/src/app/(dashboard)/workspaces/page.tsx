"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Pencil, Plus, Trash2, Save } from "lucide-react";
import { PageHeader, Card } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface WorkspaceItem {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  linkUrl: string;
}
interface Workspace {
  id: string;
  clientName: string;
  description: string | null;
  items: WorkspaceItem[];
}

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
  const [itemTitle, setItemTitle] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemLink, setItemLink] = useState("");

  const isElevated = user?.role === "MANAGER" || user?.role === "ADMIN";

  function refresh() {
    apiFetch<{ workspaces: Workspace[] }>("/workspaces").then(({ workspaces }) => setWorkspaces(workspaces));
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
      notifySuccess("Client added");
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

  async function removeClient(id: string) {
    const ok = await confirmAction({ title: "Delete this client and all its links?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/workspaces/${id}`, { method: "DELETE" });
    refresh();
    notifySuccess("Client deleted");
  }

  function openItemForm(workspaceId: string, item?: WorkspaceItem) {
    setItemFormFor(workspaceId);
    setEditingItem(item ?? null);
    setItemTitle(item?.title ?? "");
    setItemDescription(item?.description ?? "");
    setItemLink(item?.linkUrl ?? "");
  }

  async function saveItem() {
    if (!itemFormFor || !itemTitle.trim() || !itemLink.trim()) return;
    try {
      if (editingItem) {
        await apiFetch(`/workspaces/${itemFormFor}/items/${editingItem.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: itemTitle.trim(), description: itemDescription.trim(), linkUrl: itemLink.trim() }),
        });
      } else {
        await apiFetch(`/workspaces/${itemFormFor}/items`, {
          method: "POST",
          body: JSON.stringify({ title: itemTitle.trim(), description: itemDescription.trim(), linkUrl: itemLink.trim() }),
        });
      }
      setItemFormFor(null);
      setEditingItem(null);
      refresh();
      notifySuccess("Saved");
    } catch (e) {
      notifyError("Couldn't save link", e instanceof Error ? e.message : undefined);
    }
  }

  async function removeItem(workspaceId: string, itemId: string) {
    const ok = await confirmAction({ title: "Delete this link?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/workspaces/${workspaceId}/items/${itemId}`, { method: "DELETE" });
    refresh();
  }

  if (!user) return null;

  return (
    <div>
      <PageHeader title="Client Workspaces" />

      {isElevated && (
        <div className="mb-6">
          <Button icon={<Plus size={16} />} onClick={() => setShowAddClient(true)}>
            Add Client
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {workspaces.map((w) => {
          const isOpen = expanded[w.id] ?? false;
          return (
            <Card key={w.id}>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [w.id]: !isOpen }))}
                  className="flex items-center gap-2 text-left"
                >
                  {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                  <div>
                    <div className="text-sm font-semibold text-chs-charcoal">{w.clientName}</div>
                    {w.description && <div className="text-xs text-gray-400">{w.description}</div>}
                  </div>
                </button>
                {isElevated && (
                  <div className="flex items-center gap-3">
                    <button onClick={() => setEditingClient(w)} className="text-gray-400 hover:text-chs-gold" aria-label="Edit client">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => removeClient(w.id)} className="text-gray-400 hover:text-red-500" aria-label="Remove client">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="mt-4 border-t border-gray-50 pt-4">
                  <div className="space-y-2">
                    {w.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-xl bg-chs-bg px-4 py-2.5">
                        <a
                          href={item.linkUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-chs-charcoal hover:underline"
                        >
                          {item.title}
                          <ExternalLink size={12} className="text-gray-400" />
                        </a>
                        <div className="flex items-center gap-3">
                          {item.description && <span className="hidden text-xs text-gray-400 sm:inline">{item.description}</span>}
                          <button onClick={() => openItemForm(w.id, item)} className="text-gray-400 hover:text-chs-gold" aria-label="Edit link">
                            <Pencil size={14} />
                          </button>
                          {isElevated && (
                            <button onClick={() => removeItem(w.id, item.id)} className="text-gray-400 hover:text-red-500" aria-label="Delete link">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {w.items.length === 0 && <div className="text-sm text-gray-400">No links yet.</div>}
                  </div>
                  <Button size="sm" variant="secondary" icon={<Plus size={14} />} className="mt-3" onClick={() => openItemForm(w.id)}>
                    Add link
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
        {workspaces.length === 0 && (
          <Card>
            <div className="text-sm text-gray-400">No client workspaces yet.</div>
          </Card>
        )}
      </div>

      {showAddClient && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Add client</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Client name</label>
                <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Description</label>
                <textarea value={clientDescription} onChange={(e) => setClientDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAddClient(false)}>Cancel</Button>
              <Button icon={<Plus size={14} />} onClick={addClient} disabled={!clientName.trim()}>Add client</Button>
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
                <input
                  value={editingClient.clientName}
                  onChange={(e) => setEditingClient({ ...editingClient, clientName: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Description</label>
                <textarea
                  value={editingClient.description ?? ""}
                  onChange={(e) => setEditingClient({ ...editingClient, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                />
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
            <div className="text-base font-bold text-chs-charcoal">{editingItem ? "Edit link" : "Add link"}</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Title</label>
                <input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Short description</label>
                <textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">SharePoint link</label>
                <input value={itemLink} onChange={(e) => setItemLink(e.target.value)} placeholder="https://cyberhealth.sharepoint.com/..." className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setItemFormFor(null)}>Cancel</Button>
              <Button icon={<Save size={14} />} onClick={saveItem} disabled={!itemTitle.trim() || !itemLink.trim()}>Save</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

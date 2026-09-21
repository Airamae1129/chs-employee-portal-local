"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Save, CalendarDays, Cake, Eraser } from "lucide-react";
import { PageHeader, Card } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface Holiday {
  id: string;
  country: "IRELAND" | "PHILIPPINES";
  date: string;
  name: string;
  type: string;
  year: number;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "MANAGER" | "ADMIN";
  country: "IRELAND" | "PHILIPPINES";
  status: "ACTIVE" | "INACTIVE";
  birthday: string | null;
}

type Tab = "holidays" | "birthdays";

export default function AdminHolidaysPage() {
  const [tab, setTab] = useState<Tab>("holidays");
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <PageHeader
        title="Holidays & Birthdays"
        action={
          tab === "holidays" ? (
            <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>
              Add holiday
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {(
          [
            { id: "holidays", label: "Holidays", icon: <CalendarDays size={15} /> },
            { id: "birthdays", label: "Employee Birthdays", icon: <Cake size={15} /> },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.id ? "border-chs-gold text-chs-charcoal" : "border-transparent text-gray-400 hover:text-chs-charcoal"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "holidays" ? <HolidaysTab showForm={showForm} setShowForm={setShowForm} /> : <BirthdaysTab />}
    </div>
  );
}

function HolidaysTab({ showForm, setShowForm }: { showForm: boolean; setShowForm: (v: boolean) => void }) {
  const [country, setCountry] = useState<"IRELAND" | "PHILIPPINES">("IRELAND");
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState("PUBLIC_HOLIDAY");

  function refresh() {
    apiFetch<{ holidays: Holiday[] }>(`/holidays?country=${country}&year=${year}`).then(({ holidays }) => setHolidays(holidays));
  }
  useEffect(refresh, [country, year]);

  async function addHoliday() {
    try {
      await apiFetch("/holidays", {
        method: "POST",
        body: JSON.stringify({ country, date, name, type, year }),
      });
      setShowForm(false);
      setName("");
      setDate("");
      refresh();
      notifySuccess("Holiday added");
    } catch (e) {
      notifyError("Couldn't add holiday", e instanceof Error ? e.message : undefined);
    }
  }

  async function removeHoliday(id: string) {
    const ok = await confirmAction({ title: "Delete this holiday?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/holidays/${id}`, { method: "DELETE" });
    refresh();
    notifySuccess("Holiday deleted");
  }

  const typeOptions = country === "IRELAND" ? ["PUBLIC_HOLIDAY", "BANK_HOLIDAY"] : ["REGULAR_HOLIDAY", "SPECIAL_NON_WORKING_DAY", "SPECIAL_WORKING_DAY"];

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-4">
        <select value={country} onChange={(e) => setCountry(e.target.value as any)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal">
          <option value="IRELAND">Ireland</option>
          <option value="PHILIPPINES">Philippines</option>
        </select>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
        />
      </div>

      {showForm && (
        <Card className="mb-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-chs-charcoal">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-chs-charcoal">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-chs-charcoal">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal">
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button icon={<Save size={14} />} onClick={addHoliday} disabled={!name.trim() || !date}>
              Save
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                <th className="py-2">Date</th>
                <th className="py-2">Name</th>
                <th className="py-2">Type</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-b border-gray-50">
                  <td className="py-2.5">{h.date.slice(0, 10)}</td>
                  <td className="py-2.5">{h.name}</td>
                  <td className="py-2.5 text-gray-500">{h.type.replace(/_/g, " ")}</td>
                  <td className="py-2.5 text-right">
                    <Button size="sm" variant="destructive" icon={<Trash2 size={12} />} onClick={() => removeHoliday(h.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
              {holidays.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-sm text-gray-400">
                    No holidays configured for {country.toLowerCase()} {year}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/** Admin sets each employee's birthday; it then shows for everyone on Timekeeping & Calendar. */
function BirthdaysTab() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  function refresh() {
    apiFetch<{ users: Employee[] }>("/users").then(({ users }) => {
      setEmployees(users.filter((u) => u.status === "ACTIVE"));
      setDrafts({});
    });
  }
  useEffect(refresh, []);

  const current = (e: Employee) => drafts[e.id] ?? e.birthday?.slice(0, 10) ?? "";

  async function save(e: Employee, value: string | null) {
    setSavingId(e.id);
    try {
      await apiFetch(`/users/${e.id}`, { method: "PATCH", body: JSON.stringify({ birthday: value }) });
      notifySuccess(value ? "Birthday saved" : "Birthday cleared", e.name);
      refresh();
    } catch (err) {
      notifyError("Couldn't save birthday", err instanceof Error ? err.message : undefined);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Card>
      <p className="mb-4 text-sm text-gray-500">
        Set each employee&apos;s birthday. Everyone will see it as a 🎂 note on the Timekeeping &amp; Calendar page (month and day only).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
              <th className="py-2">Name</th>
              <th className="py-2">Email</th>
              <th className="py-2">Role</th>
              <th className="py-2">Country</th>
              <th className="py-2">Birthday</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const changed = current(e) !== (e.birthday?.slice(0, 10) ?? "");
              return (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="py-2.5">{e.name}</td>
                  <td className="py-2.5 text-gray-500">{e.email}</td>
                  <td className="py-2.5 capitalize">{e.role.toLowerCase()}</td>
                  <td className="py-2.5 capitalize">{e.country.toLowerCase()}</td>
                  <td className="py-2.5">
                    <input
                      type="date"
                      value={current(e)}
                      onChange={(ev) => setDrafts({ ...drafts, [e.id]: ev.target.value })}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-chs-charcoal"
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" icon={<Save size={12} />} disabled={!changed || !current(e) || savingId === e.id} onClick={() => save(e, current(e))}>
                        Save
                      </Button>
                      {e.birthday && (
                        <Button size="sm" variant="secondary" icon={<Eraser size={12} />} disabled={savingId === e.id} onClick={() => save(e, null)}>
                          Clear
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {employees.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-gray-400">
                  No active employees.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

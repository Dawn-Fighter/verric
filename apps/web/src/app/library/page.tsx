"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Finding Library — manage reusable, pre-vetted finding writeups.
//
// Pure CRUD over /api/library/findings[/:id]. Entries can later be pulled
// into a report from the studio's review step; this page is where a team
// curates the catalogue.
// ─────────────────────────────────────────────────────────────────────────

type FindingLibraryEntry = {
  id: string;
  name: string;
  category: string;
  severity: string;
  defaultCvssVector: string | null;
  description: string | null;
  impact: string | null;
  remediation: string | null;
  references: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

const SEVERITIES = ["Critical", "High", "Medium", "Low", "Informational", "Review"];

const EMPTY_FORM = {
  id: "",
  name: "",
  category: "",
  severity: "Medium",
  defaultCvssVector: "",
  description: "",
  impact: "",
  remediation: "",
  references: "",
  tags: ""
};

type FormState = typeof EMPTY_FORM;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function severityClass(severity: string) {
  if (severity === "Critical" || severity === "High") return "text-verric";
  if (severity === "Medium" || severity === "Review") return "text-warn";
  return "text-good";
}

export default function LibraryPage() {
  const [entries, setEntries] = useState<FindingLibraryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const isEditing = form.id.length > 0;

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = q.trim()
        ? `/api/library/findings?search=${encodeURIComponent(q.trim())}`
        : "/api/library/findings";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load library (HTTP ${res.status})`);
      const data = (await res.json()) as { entries: FindingLibraryEntry[] };
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startEdit(entry: FindingLibraryEntry) {
    setForm({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      severity: entry.severity,
      defaultCvssVector: entry.defaultCvssVector ?? "",
      description: entry.description ?? "",
      impact: entry.impact ?? "",
      remediation: entry.remediation ?? "",
      references: entry.references.join(", "),
      tags: entry.tags.join(", ")
    });
    setNotice(null);
    setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setNotice(null);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.category.trim()) {
      setError("Name and category are required.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      category: form.category.trim(),
      severity: form.severity,
      defaultCvssVector: form.defaultCvssVector.trim() || null,
      description: form.description.trim() || null,
      impact: form.impact.trim() || null,
      remediation: form.remediation.trim() || null,
      references: splitList(form.references),
      tags: splitList(form.tags)
    };
    try {
      const res = isEditing
        ? await fetch(`/api/library/findings/${encodeURIComponent(form.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          })
        : await fetch("/api/library/findings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error || `Save failed (HTTP ${res.status})`);
      }
      const savedMessage = isEditing ? "Finding updated." : "Finding added to library.";
      resetForm();
      setNotice(savedMessage);
      await load(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: FindingLibraryEntry) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${entry.name}" from the library?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/findings/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (HTTP ${res.status})`);
      setNotice("Finding removed.");
      if (form.id === entry.id) resetForm();
      await load(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const count = useMemo(() => entries.length, [entries]);

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1200px] border-x border-rule bg-paper/70">
        <header className="flex flex-wrap items-center justify-between gap-4 border-y border-rule px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 bg-verric" />
            <span className="font-mono text-xs font-bold uppercase tracking-[0.26em]">Verric</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted">
              · Finding Library
            </span>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 border border-rule bg-paper px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-ink transition hover:bg-panel"
          >
            ← Back to Studio
          </a>
        </header>

        <div className="grid gap-0 lg:grid-cols-[420px_1fr]">
          {/* ── Form ─────────────────────────────────────────────── */}
          <section className="border-b border-rule p-5 lg:border-b-0 lg:border-r">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">
              {isEditing ? "Edit finding" : "New finding"}
            </p>
            <form className="mt-4 space-y-3" onSubmit={submit}>
              <Field label="Name *">
                <input
                  data-testid="field-name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Reflected Cross-Site Scripting"
                  className={inputCx}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category *">
                  <input
                    data-testid="field-category"
                    value={form.category}
                    onChange={(e) => update("category", e.target.value)}
                    placeholder="Injection"
                    className={inputCx}
                  />
                </Field>
                <Field label="Severity">
                  <select
                    data-testid="field-severity"
                    value={form.severity}
                    onChange={(e) => update("severity", e.target.value)}
                    className={inputCx}
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Default CVSS vector">
                <input
                  data-testid="field-cvss"
                  value={form.defaultCvssVector}
                  onChange={(e) => update("defaultCvssVector", e.target.value)}
                  placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"
                  className={cx(inputCx, "font-mono text-[11px]")}
                />
              </Field>
              <Field label="Description">
                <textarea
                  data-testid="field-description"
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  rows={3}
                  className={inputCx}
                />
              </Field>
              <Field label="Impact">
                <textarea
                  value={form.impact}
                  onChange={(e) => update("impact", e.target.value)}
                  rows={2}
                  className={inputCx}
                />
              </Field>
              <Field label="Remediation">
                <textarea
                  value={form.remediation}
                  onChange={(e) => update("remediation", e.target.value)}
                  rows={2}
                  className={inputCx}
                />
              </Field>
              <Field label="References (comma-separated)">
                <input
                  data-testid="field-references"
                  value={form.references}
                  onChange={(e) => update("references", e.target.value)}
                  placeholder="OWASP Top 10 A03: Injection, CWE-79"
                  className={inputCx}
                />
              </Field>
              <Field label="Tags (comma-separated)">
                <input
                  value={form.tags}
                  onChange={(e) => update("tags", e.target.value)}
                  placeholder="web, xss, owasp"
                  className={inputCx}
                />
              </Field>

              {error ? (
                <p data-testid="form-error" className="font-mono text-[11px] text-verric">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p data-testid="form-notice" className="font-mono text-[11px] text-good">
                  {notice}
                </p>
              ) : null}

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  data-testid="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 bg-verric px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-paper transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Saving…" : isEditing ? "Update finding" : "Add to library"}
                </button>
                {isEditing ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center gap-2 border border-rule bg-paper px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-ink transition hover:bg-panel"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          {/* ── List ─────────────────────────────────────────────── */}
          <section className="p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">
                Library · <span data-testid="count">{count}</span> {count === 1 ? "entry" : "entries"}
              </p>
              <input
                data-testid="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void load(search);
                }}
                placeholder="Search name / category…"
                className="w-56 border border-rule bg-paper px-3 py-2 font-mono text-[11px] outline-none focus:border-verric"
              />
            </div>

            <div className="mt-4 space-y-2" data-testid="entries">
              {loading ? (
                <p className="font-mono text-[11px] text-muted">Loading…</p>
              ) : entries.length === 0 ? (
                <p
                  data-testid="empty"
                  className="border border-dashed border-rule p-6 text-center font-mono text-[11px] text-muted"
                >
                  No findings yet. Add one on the left to start the catalogue.
                </p>
              ) : (
                entries.map((entry) => (
                  <article
                    key={entry.id}
                    data-testid="entry"
                    data-entry-name={entry.name}
                    className="border border-rule bg-paper/60 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-serifdeck text-lg leading-tight">{entry.name}</h3>
                        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                          {entry.category}
                          {" · "}
                          <span className={severityClass(entry.severity)}>{entry.severity}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          data-testid="edit"
                          onClick={() => startEdit(entry)}
                          className="border border-rule bg-paper px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-ink transition hover:bg-panel"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          data-testid="delete"
                          onClick={() => remove(entry)}
                          className="border border-verric bg-verric/5 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-verric transition hover:bg-verric/15"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {entry.description ? (
                      <p className="mt-2 text-sm leading-relaxed text-ink/90">{entry.description}</p>
                    ) : null}
                    {entry.references.length > 0 ? (
                      <p className="mt-2 font-mono text-[10px] text-muted">
                        Refs: {entry.references.join(" · ")}
                      </p>
                    ) : null}
                    {entry.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {entry.tags.map((t) => (
                          <span
                            key={t}
                            className="border border-rule bg-panel px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

const inputCx =
  "w-full border border-rule bg-paper px-3 py-2 text-sm outline-none transition focus:border-verric";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      {children}
    </label>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

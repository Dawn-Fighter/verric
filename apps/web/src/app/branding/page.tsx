"use client";

import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Branding — manage per-firm report themes (logo, colors, footer, cover
// subtitle). Pure CRUD over /api/branding[/:id]. The PDF exporter resolves
// branding by id, or falls back to whichever profile is marked default.
// ─────────────────────────────────────────────────────────────────────────

type ReportBranding = {
  id: string;
  name: string;
  logoDataUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  footerText: string | null;
  coverSubtitle: string | null;
  customCss: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
};

const EMPTY_FORM = {
  id: "",
  name: "",
  logoDataUrl: "",
  primaryColor: "#1f3a5f",
  secondaryColor: "#2f5f95",
  accentColor: "#a15c07",
  footerText: "",
  coverSubtitle: "",
  customCss: "",
  isDefault: false
};

type FormState = typeof EMPTY_FORM;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const inputCx =
  "w-full border border-rule bg-paper px-3 py-2 text-sm outline-none transition focus:border-verric";

export default function BrandingPage() {
  const [profiles, setProfiles] = useState<ReportBranding[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const isEditing = form.id.length > 0;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/branding");
      if (!res.ok) throw new Error(`Failed to load branding (HTTP ${res.status})`);
      const data = (await res.json()) as { branding: ReportBranding[] };
      setProfiles(data.branding);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load branding");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startEdit(p: ReportBranding) {
    setForm({
      id: p.id,
      name: p.name,
      logoDataUrl: p.logoDataUrl ?? "",
      primaryColor: p.primaryColor ?? "#1f3a5f",
      secondaryColor: p.secondaryColor ?? "#2f5f95",
      accentColor: p.accentColor ?? "#a15c07",
      footerText: p.footerText ?? "",
      coverSubtitle: p.coverSubtitle ?? "",
      customCss: p.customCss ?? "",
      isDefault: p.isDefault
    });
    setNotice(null);
    setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError("Logo must be under 512 KB.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    update("logoDataUrl", dataUrl);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      logoDataUrl: form.logoDataUrl || null,
      primaryColor: form.primaryColor || null,
      secondaryColor: form.secondaryColor || null,
      accentColor: form.accentColor || null,
      footerText: form.footerText.trim() || null,
      coverSubtitle: form.coverSubtitle.trim() || null,
      customCss: form.customCss.trim() || null,
      isDefault: form.isDefault
    };
    try {
      const res = isEditing
        ? await fetch(`/api/branding/${encodeURIComponent(form.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          })
        : await fetch("/api/branding", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error || `Save failed (HTTP ${res.status})`);
      }
      const savedMessage = isEditing ? "Branding updated." : "Branding profile created.";
      resetForm();
      setNotice(savedMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: ReportBranding) {
    if (typeof window !== "undefined" && !window.confirm(`Delete branding "${p.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/branding/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (HTTP ${res.status})`);
      if (form.id === p.id) resetForm();
      setNotice("Branding removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1200px] border-x border-rule bg-paper/70">
        <header className="flex flex-wrap items-center justify-between gap-4 border-y border-rule px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 bg-verric" />
            <span className="font-mono text-xs font-bold uppercase tracking-[0.26em]">Verric</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted">· Branding</span>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 border border-rule bg-paper px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-ink transition hover:bg-panel"
          >
            ← Back to Studio
          </a>
        </header>

        <div className="grid gap-0 lg:grid-cols-[440px_1fr]">
          {/* ── Form + preview ───────────────────────────────────── */}
          <section className="border-b border-rule p-5 lg:border-b-0 lg:border-r">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">
              {isEditing ? "Edit branding" : "New branding profile"}
            </p>

            {/* Live cover preview */}
            <div className="mt-4 overflow-hidden border border-rule bg-white" data-testid="preview">
              <div style={{ height: 8, backgroundColor: form.primaryColor }} />
              <div className="p-4">
                {form.logoDataUrl ? (
                  <img src={form.logoDataUrl} alt="logo preview" style={{ height: 34, marginBottom: 10 }} />
                ) : null}
                <div style={{ color: form.primaryColor, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>
                  Penetration Test Report
                </div>
                <div style={{ color: "#374151", fontSize: 13, marginTop: 4 }}>
                  {form.coverSubtitle || "Cover subtitle preview"}
                </div>
              </div>
              <div className="flex justify-between border-t border-gray-200 px-4 py-1.5">
                <span style={{ fontSize: 9, color: "#6b7280" }}>
                  {form.footerText || "Footer text preview"}
                </span>
              </div>
            </div>

            <form className="mt-4 space-y-3" onSubmit={submit}>
              <Field label="Name *">
                <input
                  data-testid="field-name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Acme house style"
                  className={inputCx}
                />
              </Field>

              <Field label="Logo (PNG/SVG, ≤512 KB)">
                <div className="flex items-center gap-3">
                  <input
                    data-testid="field-logo"
                    type="file"
                    accept="image/*"
                    onChange={onLogoFile}
                    className="text-xs"
                  />
                  {form.logoDataUrl ? (
                    <button
                      type="button"
                      onClick={() => update("logoDataUrl", "")}
                      className="border border-rule bg-paper px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted hover:bg-panel"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <ColorField
                  label="Primary"
                  testId="field-primary"
                  value={form.primaryColor}
                  onChange={(v) => update("primaryColor", v)}
                />
                <ColorField
                  label="Secondary"
                  testId="field-secondary"
                  value={form.secondaryColor}
                  onChange={(v) => update("secondaryColor", v)}
                />
                <ColorField
                  label="Accent"
                  testId="field-accent"
                  value={form.accentColor}
                  onChange={(v) => update("accentColor", v)}
                />
              </div>

              <Field label="Cover subtitle">
                <input
                  data-testid="field-subtitle"
                  value={form.coverSubtitle}
                  onChange={(e) => update("coverSubtitle", e.target.value)}
                  placeholder="Confidential — prepared for Acme Corp"
                  className={inputCx}
                />
              </Field>
              <Field label="Footer text">
                <input
                  data-testid="field-footer"
                  value={form.footerText}
                  onChange={(e) => update("footerText", e.target.value)}
                  placeholder="© 2026 Acme Security · Confidential"
                  className={inputCx}
                />
              </Field>

              <label className="flex items-center gap-2">
                <input
                  data-testid="field-default"
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => update("isDefault", e.target.checked)}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                  Use as default for exports
                </span>
              </label>

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
                  {busy ? "Saving…" : isEditing ? "Update branding" : "Create branding"}
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
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">
              Profiles · <span data-testid="count">{profiles.length}</span>{" "}
              {profiles.length === 1 ? "profile" : "profiles"}
            </p>

            <div className="mt-4 space-y-2" data-testid="entries">
              {loading ? (
                <p className="font-mono text-[11px] text-muted">Loading…</p>
              ) : profiles.length === 0 ? (
                <p
                  data-testid="empty"
                  className="border border-dashed border-rule p-6 text-center font-mono text-[11px] text-muted"
                >
                  No branding profiles yet. Create one on the left; mark it default and exports will use it.
                </p>
              ) : (
                profiles.map((p) => (
                  <article
                    key={p.id}
                    data-testid="entry"
                    data-entry-name={p.name}
                    data-default={p.isDefault ? "1" : "0"}
                    className="border border-rule bg-paper/60 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {[p.primaryColor, p.secondaryColor, p.accentColor].map((c, i) => (
                            <span
                              key={i}
                              title={c ?? ""}
                              style={{ backgroundColor: c ?? "transparent" }}
                              className="h-5 w-5 border border-rule"
                            />
                          ))}
                        </div>
                        <div>
                          <h3 className="font-serifdeck text-lg leading-tight">
                            {p.name}
                            {p.isDefault ? (
                              <span
                                data-testid="default-badge"
                                className="ml-2 border border-good bg-good/10 px-1.5 py-0.5 align-middle font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-good"
                              >
                                default
                              </span>
                            ) : null}
                          </h3>
                          {p.coverSubtitle ? (
                            <p className="mt-0.5 text-xs text-muted">{p.coverSubtitle}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          data-testid="edit"
                          onClick={() => startEdit(p)}
                          className="border border-rule bg-paper px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-ink transition hover:bg-panel"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          data-testid="delete"
                          onClick={() => remove(p)}
                          className="border border-verric bg-verric/5 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-verric transition hover:bg-verric/15"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {p.logoDataUrl ? (
                      <img src={p.logoDataUrl} alt={`${p.name} logo`} className="mt-2 h-6" />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      {children}
    </label>
  );
}

function ColorField({
  label,
  testId,
  value,
  onChange
}: {
  label: string;
  testId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-8 shrink-0 cursor-pointer border border-rule bg-paper p-0"
        />
        <input
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cx(inputCx, "font-mono text-[11px]")}
        />
      </div>
    </label>
  );
}

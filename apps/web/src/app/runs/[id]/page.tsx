"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────
// Run detail — summary, version history, and a claim-level diff between any
// two report versions. Reads:
//   GET /api/runs/[id]            (summary + receipt)
//   GET /api/runs/[id]/versions   (version list)
//   GET /api/runs/[id]/diff?from&to  (claim-level diff)
// ─────────────────────────────────────────────────────────────────────────

type RunDetail = {
  id: string;
  template: string;
  providerId: string;
  model: string;
  status: string;
  failureStage: string | null;
  failureMessage: string | null;
  durationMs: number | null;
  createdAt: number;
  completedAt: number | null;
  project: { clientName: string; projectName: string };
  receipt: { signature: string; template: string; model: string } | null;
};

type VersionRow = {
  version: number;
  parentVersion: number | null;
  editedBy: string | null;
  editSummary: string | null;
  createdAt: number;
};

type Claim = { id: string; text: string; evidenceIds: string[]; status: string };
type DiffResponse = {
  from: { version: number; createdAt: number };
  to: { version: number; createdAt: number };
  added: string[];
  removed: string[];
  modified: Array<{
    claimId: string;
    before: Claim;
    after: Claim;
    changed: { text: boolean; evidenceIds: boolean; status: boolean };
  }>;
};

function statusClass(status: string) {
  if (status === "succeeded" || status === "grounded") return "text-good";
  if (status === "failed" || status === "canary_triggered" || status === "flagged") return "text-verric";
  return "text-warn";
}

export default function RunDetailPage() {
  const params = useParams();
  const runId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [run, setRun] = useState<RunDetail | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [fromV, setFromV] = useState<number>(1);
  const [toV, setToV] = useState<number>(1);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runRes, verRes] = await Promise.all([
        fetch(`/api/runs/${runId}`),
        fetch(`/api/runs/${runId}/versions`)
      ]);
      if (!runRes.ok) throw new Error(`Run not found (HTTP ${runRes.status})`);
      const { run: r } = (await runRes.json()) as { run: RunDetail };
      const { versions: v } = (await verRes.json()) as { versions: VersionRow[] };
      setRun(r);
      setVersions(v);
      if (v.length > 0) {
        const maxV = Math.max(...v.map((x) => x.version));
        setFromV(1);
        setToV(maxV);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void loadCore();
  }, [loadCore]);

  const loadDiff = useCallback(async () => {
    if (versions.length === 0) return;
    try {
      const res = await fetch(`/api/runs/${runId}/diff?from=${fromV}&to=${toV}`);
      if (!res.ok) throw new Error(`Diff failed (HTTP ${res.status})`);
      setDiff((await res.json()) as DiffResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diff");
    }
  }, [runId, fromV, toV, versions.length]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  const versionNumbers = useMemo(() => versions.map((v) => v.version).sort((a, b) => a - b), [versions]);
  const hasChanges = diff && (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0);

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1200px] border-x border-rule bg-paper/70">
        <header className="flex flex-wrap items-center justify-between gap-4 border-y border-rule px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 bg-verric" />
            <span className="font-mono text-xs font-bold uppercase tracking-[0.26em]">Verric</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted">
              · Run {runId.slice(0, 8)}
            </span>
          </div>
          <a
            href="/runs"
            className="inline-flex items-center gap-2 border border-rule bg-paper px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-ink transition hover:bg-panel"
          >
            ← All Runs
          </a>
        </header>

        {loading ? (
          <p className="p-5 font-mono text-[11px] text-muted">Loading…</p>
        ) : error && !run ? (
          <p data-testid="error" className="p-5 font-mono text-[11px] text-verric">
            {error}
          </p>
        ) : run ? (
          <div className="grid gap-0 lg:grid-cols-[340px_1fr]">
            {/* ── Summary + version history ─────────────────────── */}
            <section className="border-b border-rule p-5 lg:border-b-0 lg:border-r">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">
                Run summary
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                <SummaryRow
                  label="Project"
                  value={`${run.project.clientName} · ${run.project.projectName}`}
                />
                <SummaryRow label="Template" value={run.template} mono />
                <SummaryRow
                  label="Status"
                  value={
                    <span className={statusClass(run.status)} data-testid="status">
                      {run.status}
                    </span>
                  }
                />
                <SummaryRow label="Provider" value={`${run.providerId} · ${run.model}`} mono />
                {run.durationMs != null ? (
                  <SummaryRow label="Duration" value={`${run.durationMs} ms`} mono />
                ) : null}
                {run.failureStage ? (
                  <SummaryRow label="Failure" value={`${run.failureStage}: ${run.failureMessage ?? ""}`} />
                ) : null}
                {run.receipt ? (
                  <SummaryRow
                    label="Receipt"
                    value={
                      <span className="font-mono text-[11px]">{run.receipt.signature.slice(0, 16)}…</span>
                    }
                  />
                ) : null}
              </dl>

              <p className="mt-6 font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">
                Version history · <span data-testid="version-count">{versions.length}</span>
              </p>
              <ol className="mt-3 space-y-1.5" data-testid="versions">
                {versions.map((v) => (
                  <li
                    key={v.version}
                    data-testid="version-row"
                    data-version={v.version}
                    className="border border-rule bg-paper/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-bold">v{v.version}</span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
                        {new Date(v.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink/80">
                      {v.editSummary ?? "—"}
                      {v.editedBy ? <span className="text-muted"> · {v.editedBy}</span> : null}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            {/* ── Diff viewer ───────────────────────────────────── */}
            <section className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">
                  Diff
                </p>
                <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  from
                  <select
                    data-testid="from-select"
                    value={fromV}
                    onChange={(e) => setFromV(Number(e.target.value))}
                    className="border border-rule bg-paper px-2 py-1 text-xs"
                  >
                    {versionNumbers.map((n) => (
                      <option key={n} value={n}>
                        v{n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  to
                  <select
                    data-testid="to-select"
                    value={toV}
                    onChange={(e) => setToV(Number(e.target.value))}
                    className="border border-rule bg-paper px-2 py-1 text-xs"
                  >
                    {versionNumbers.map((n) => (
                      <option key={n} value={n}>
                        v{n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 space-y-3" data-testid="diff">
                {!diff ? (
                  <p className="font-mono text-[11px] text-muted">Select versions to compare.</p>
                ) : !hasChanges ? (
                  <p
                    data-testid="diff-empty"
                    className="border border-dashed border-rule p-6 text-center font-mono text-[11px] text-muted"
                  >
                    No claim-level differences between v{diff.from.version} and v{diff.to.version}.
                  </p>
                ) : (
                  <>
                    {diff.modified.length > 0 ? (
                      <div data-testid="diff-modified">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-warn">
                          Modified ({diff.modified.length})
                        </p>
                        <div className="mt-2 space-y-2">
                          {diff.modified.map((m) => (
                            <article
                              key={m.claimId}
                              data-testid="modified-claim"
                              data-claim-id={m.claimId}
                              className="border border-rule bg-paper/60 p-3"
                            >
                              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                                {m.claimId}
                                {m.changed.status ? (
                                  <span className="ml-2">
                                    status:{" "}
                                    <span className={statusClass(m.before.status)}>{m.before.status}</span>
                                    {" → "}
                                    <span className={statusClass(m.after.status)}>{m.after.status}</span>
                                  </span>
                                ) : null}
                              </p>
                              {m.changed.text ? (
                                <div className="mt-1.5 space-y-1 text-sm">
                                  <p className="bg-verric/5 px-2 py-1 text-verric line-through decoration-verric/50">
                                    {m.before.text}
                                  </p>
                                  <p className="bg-good/5 px-2 py-1 text-good">{m.after.text}</p>
                                </div>
                              ) : null}
                              {m.changed.evidenceIds ? (
                                <p className="mt-1 font-mono text-[10px] text-muted">
                                  evidence: {m.before.evidenceIds.join(", ") || "—"} →{" "}
                                  {m.after.evidenceIds.join(", ") || "—"}
                                </p>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {diff.added.length > 0 ? (
                      <div data-testid="diff-added">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-good">
                          Added ({diff.added.length})
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-muted">{diff.added.join(", ")}</p>
                      </div>
                    ) : null}

                    {diff.removed.length > 0 ? (
                      <div data-testid="diff-removed">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-verric">
                          Removed ({diff.removed.length})
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-muted">{diff.removed.join(", ")}</p>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-rule/50 pb-1.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className={mono ? "text-right font-mono text-[11px]" : "text-right text-sm"}>{value}</dd>
    </div>
  );
}

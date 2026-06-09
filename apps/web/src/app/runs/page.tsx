"use client";

import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Runs index — every run Verric has recorded (succeeded, failed, queued,
// running, canary_triggered). Each links to its detail + version-history
// + diff page. Reads GET /api/runs.
// ─────────────────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  template: string;
  providerId: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canary_triggered";
  failureStage: string | null;
  durationMs: number | null;
  createdAt: number;
};

function statusClass(status: string) {
  if (status === "succeeded") return "text-good";
  if (status === "failed" || status === "canary_triggered") return "text-verric";
  return "text-warn";
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString();
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/runs?limit=100");
      if (!res.ok) throw new Error(`Failed to load runs (HTTP ${res.status})`);
      const data = (await res.json()) as { runs: RunRow[] };
      setRuns(data.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1200px] border-x border-rule bg-paper/70">
        <header className="flex flex-wrap items-center justify-between gap-4 border-y border-rule px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 bg-verric" />
            <span className="font-mono text-xs font-bold uppercase tracking-[0.26em]">Verric</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted">· Runs</span>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 border border-rule bg-paper px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-ink transition hover:bg-panel"
          >
            ← Back to Studio
          </a>
        </header>

        <section className="p-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">
            Run history · <span data-testid="count">{runs.length}</span> {runs.length === 1 ? "run" : "runs"}
          </p>

          {error ? <p className="mt-3 font-mono text-[11px] text-verric">{error}</p> : null}

          <div className="mt-4" data-testid="runs">
            {loading ? (
              <p className="font-mono text-[11px] text-muted">Loading…</p>
            ) : runs.length === 0 ? (
              <p
                data-testid="empty"
                className="border border-dashed border-rule p-6 text-center font-mono text-[11px] text-muted"
              >
                No runs yet. Generate a report from the studio and it will show up here.
              </p>
            ) : (
              <div className="overflow-hidden border border-rule">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                    <tr className="border-b border-rule">
                      <th className="p-3">Run</th>
                      <th className="p-3">Template</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Provider</th>
                      <th className="p-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr
                        key={run.id}
                        data-testid="run-row"
                        data-run-id={run.id}
                        className="border-b border-rule last:border-b-0 hover:bg-panel"
                      >
                        <td className="p-3">
                          <a
                            data-testid="run-link"
                            href={`/runs/${run.id}`}
                            className="font-mono text-[11px] text-verric underline-offset-2 hover:underline"
                          >
                            {run.id.slice(0, 8)}
                          </a>
                        </td>
                        <td className="p-3 font-mono text-[11px]">{run.template}</td>
                        <td className="p-3">
                          <span
                            className={`font-mono text-[10px] font-bold uppercase tracking-[0.18em] ${statusClass(run.status)}`}
                          >
                            {run.status}
                          </span>
                          {run.failureStage ? (
                            <span className="ml-1 font-mono text-[10px] text-muted">
                              ({run.failureStage})
                            </span>
                          ) : null}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-muted">
                          {run.providerId} · {run.model}
                        </td>
                        <td className="p-3 font-mono text-[10px] text-muted">{fmtTime(run.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

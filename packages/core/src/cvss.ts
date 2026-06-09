// CVSS 3.1 base score — pure, no deps. Computes from vector so score, vector,
// and severity can never disagree. This is the deterministic core of Verric's
// trust story: an LLM cannot pick a number that disagrees with its own math.

import type { Severity } from "./types";

const CVSS_METRICS: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR_U: { N: 0.85, L: 0.62, H: 0.27 },
  PR_C: { N: 0.85, L: 0.68, H: 0.5 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 }
};

export function severityFromScore(score: number): Severity {
  if (score >= 9) return "Critical";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  if (score > 0) return "Low";
  return "Informational";
}

function roundUp1(value: number) {
  // CVSS roundup: ceil to one decimal place (per spec, with float-safety)
  const r = Math.round(value * 100000);
  if (r % 10000 === 0) return r / 100000;
  return (Math.floor(r / 10000) + 1) / 10;
}

export function cvssFromVector(vector: string): { score: number; severity: Severity } | null {
  if (!vector || vector === "N/A") return null;
  const m = vector.match(/CVSS:3\.[01]\/(.+)/i);
  if (!m) return null;
  const parts = m[1].split("/").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split(":");
    if (k && v) acc[k.trim().toUpperCase()] = v.trim().toUpperCase();
    return acc;
  }, {});

  const required = ["AV", "AC", "PR", "UI", "S", "C", "I", "A"];
  for (const key of required) if (!(key in parts)) return null;

  const scope = parts.S; // U or C
  const av = CVSS_METRICS.AV[parts.AV];
  const ac = CVSS_METRICS.AC[parts.AC];
  const pr = (scope === "C" ? CVSS_METRICS.PR_C : CVSS_METRICS.PR_U)[parts.PR];
  const ui = CVSS_METRICS.UI[parts.UI];
  const c = CVSS_METRICS.C[parts.C];
  const i = CVSS_METRICS.I[parts.I];
  const a = CVSS_METRICS.A[parts.A];
  if ([av, ac, pr, ui, c, i, a].some((v) => v === undefined)) return null;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scope === "C" ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;

  let score: number;
  if (impact <= 0) {
    score = 0;
  } else if (scope === "C") {
    score = roundUp1(Math.min(1.08 * (impact + exploitability), 10));
  } else {
    score = roundUp1(Math.min(impact + exploitability, 10));
  }

  return { score, severity: severityFromScore(score) };
}

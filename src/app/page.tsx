"use client";

import { useMemo, useRef, useState } from "react";
import {
  type EvidenceArtifact,
  type EvidenceChunk,
  type EvidenceGap,
  type Finding,
  type ProjectDetails,
  type ReportClaim,
  type VerricReport,
  allClaims,
  buildEvidenceChunks,
  createMockReport,
  emptyProjectDetails,
  inferEvidenceKind,
  isNmapContent,
  parseNmap,
  readinessLabel,
  renderPlainTextReport,
  validateReport
} from "@/lib/report";

type GenerationMode = "idle" | "openai" | "mock";
type StudioStep = "setup" | "evidence" | "review" | "draft" | "export";

const steps: Array<{ id: StudioStep; label: string; title: string }> = [
  { id: "setup", label: "01", title: "Project Setup" },
  { id: "evidence", label: "02", title: "Evidence Intake" },
  { id: "review", label: "03", title: "Verric Review" },
  { id: "draft", label: "04", title: "Report Draft" },
  { id: "export", label: "05", title: "Export" }
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-muted">{children}</p>;
}

function severityClass(severity: string) {
  if (severity === "Critical" || severity === "High" || severity === "unsupported") return "text-verric";
  if (severity === "Medium" || severity === "Review" || severity === "needs_poc" || severity === "needs_details") return "text-warn";
  return "text-good";
}

function readinessClass(status: string) {
  if (status === "ready") return "border-good bg-good/5 text-good";
  if (status === "unsupported") return "border-verric bg-softred text-verric";
  return "border-warn bg-warn/5 text-warn";
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const base = "mt-2 w-full border border-rule bg-[#fbf7ed] px-3 py-3 text-sm outline-none transition focus:border-verric";
  return (
    <label className="block">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted">{label}</span>
      {multiline ? (
        <textarea className={cx(base, "min-h-[100px] resize-y")} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={base} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function ArtifactPreview({ artifact }: { artifact: EvidenceArtifact }) {
  if (artifact.preview) {
    return <img src={artifact.preview} alt="Evidence preview" className="mt-3 max-h-40 border border-rule object-cover" />;
  }
  if (artifact.content && isNmapContent(artifact.content)) {
    const hosts = parseNmap(artifact.content);
    if (hosts.length > 0) {
      return (
        <div className="mt-3 border border-rule bg-[#fbf7ed]">
          <p className="border-b border-rule bg-panel px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-verric">Parsed by Verric · Hosts &amp; Services</p>
          {hosts.map((host) => (
            <div key={host.ip || host.host} className="border-b border-rule last:border-b-0">
              <p className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                {host.host || host.ip}{host.host && host.ip ? ` · ${host.ip}` : ""}
              </p>
              <table className="w-full border-t border-rule text-left font-mono text-[10px]">
                <thead className="text-muted">
                  <tr className="border-b border-rule">
                    <th className="px-3 py-1">Port</th>
                    <th className="px-3 py-1">State</th>
                    <th className="px-3 py-1">Service</th>
                    <th className="px-3 py-1">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {host.ports.map((port) => (
                    <tr key={`${port.port}/${port.proto}`} className="border-b border-rule last:border-b-0">
                      <td className="px-3 py-1 font-bold text-ink">{port.port}/{port.proto}</td>
                      <td className="px-3 py-1 text-good">{port.state}</td>
                      <td className="px-3 py-1">{port.service}</td>
                      <td className="px-3 py-1 text-muted">{port.version || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }
  }
  return <p className="mt-3 line-clamp-3 font-mono text-xs leading-relaxed text-muted">{artifact.content}</p>;
}

function GapCard({ gap }: { gap: EvidenceGap }) {
  return (
    <div className={cx("border-l-2 px-4 py-3", gap.severity === "blocking" ? "border-verric bg-softred" : "border-warn bg-panel")}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-verric">{gap.type.replaceAll("_", " ")}</p>
      <h4 className="mt-2 font-serifdeck text-2xl font-semibold leading-tight">{gap.title}</h4>
      <p className="mt-2 text-sm leading-relaxed text-muted">{gap.message}</p>
      {gap.suggestedEvidence.length > 0 ? (
        <div className="mt-3 border-t border-rule pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">Verric needs</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {gap.suggestedEvidence.map((item) => (
              <span key={item} className="border border-rule bg-paper px-2 py-1 text-xs text-ink">
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ClaimBlock({ claim, onSelect, active }: { claim: ReportClaim; onSelect: (claim: ReportClaim) => void; active: boolean }) {
  const unverified = claim.status === "needs_review" || claim.status === "flagged";
  return (
    <button
      type="button"
      onClick={() => onSelect(claim)}
      onMouseEnter={() => onSelect(claim)}
      className={cx("block w-full border-l-2 px-3 py-2 text-left text-sm leading-relaxed transition", active ? "bg-softred" : "hover:bg-panel", claim.status === "grounded" ? "border-good" : "border-warn")}
    >
      <span>{claim.text}</span>
      {unverified ? <span className="ml-2 inline-flex items-center gap-1 border border-warn bg-warn/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-warn" title={claim.groundingNote || "Verric could not confirm cited evidence supports this claim."}>⚠ {claim.status === "flagged" ? "unsupported" : "unverified"}</span> : null}
      <span className={cx("ml-2 font-mono text-[9px] font-bold uppercase tracking-[0.2em]", claim.status === "grounded" ? "text-good" : "text-warn")}>{claim.status}</span>
      <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{claim.evidenceIds.join(" · ") || "needs evidence"}</span>
      {claim.groundingNote ? <span className="mt-1 block font-mono text-[10px] leading-relaxed text-muted">{claim.groundingNote}</span> : null}
    </button>
  );
}

function FindingReviewCard({ finding }: { finding: Finding }) {
  const checklist = [
    ["Affected asset", finding.affectedAssets.length > 0],
    ["CVSS rationale", finding.cvss !== "N/A" && finding.cvssVector !== "N/A"],
    ["Description evidence", finding.description.some((claim) => claim.evidenceIds.length > 0)],
    ["Proof of Concept", finding.proofOfConcept.some((claim) => claim.evidenceIds.length > 0) && !finding.gaps.some((gap) => gap.type === "missing_poc")],
    ["Impact explained", finding.impact.length > 0],
    ["Remediation", finding.remediation.length > 0]
  ] as const;

  return (
    <article className="border border-rule bg-paper">
      <div className="grid gap-0 border-b border-rule lg:grid-cols-[1fr_220px]">
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-verric">{finding.id}</span>
            <span className={cx("border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em]", readinessClass(finding.readiness))}>
              {readinessLabel(finding.readiness)}
            </span>
          </div>
          <h3 className="mt-3 font-serifdeck text-4xl font-semibold leading-none">{finding.title}</h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{finding.readinessSummary}</p>
        </div>
        <div className="border-t border-rule p-5 lg:border-l lg:border-t-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">Severity</p>
          <p className={cx("font-serifdeck text-5xl font-semibold", severityClass(finding.severity))}>{finding.severity}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">CVSS {finding.cvss}</p>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[300px_1fr]">
        <div className="border-b border-rule p-5 lg:border-b-0 lg:border-r">
          <SectionLabel>Readiness Checklist</SectionLabel>
          <div className="mt-4 space-y-2">
            {checklist.map(([label, ok]) => (
              <div key={label} className="flex items-center justify-between border-b border-rule pb-2 text-sm last:border-b-0">
                <span>{label}</span>
                <span className={cx("font-mono text-[10px] font-bold uppercase tracking-[0.18em]", ok ? "text-good" : "text-verric")}>{ok ? "Ready" : "Missing"}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5">
          <SectionLabel>What Verric Needs Before Export</SectionLabel>
          <div className="mt-4 space-y-3">
            {finding.gaps.length > 0 ? finding.gaps.map((gap) => <GapCard key={gap.id} gap={gap} />) : <p className="border border-good/40 bg-good/5 p-4 text-sm text-good">No blocking gaps. This finding is ready for a polished client report.</p>}
          </div>
        </div>
      </div>
    </article>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<StudioStep>("setup");
  const [project, setProject] = useState<ProjectDetails>(emptyProjectDetails);
  const [artifacts, setArtifacts] = useState<EvidenceArtifact[]>([]);
  const [manualNotes, setManualNotes] = useState("");
  const chunks = useMemo(() => buildEvidenceChunks(artifacts, manualNotes), [artifacts, manualNotes]);
  const [report, setReport] = useState<VerricReport>(() => validateReport(createMockReport(chunks, project), chunks, project));
  const [mode, setMode] = useState<GenerationMode>("mock");
  const [hasReviewed, setHasReviewed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeEvidenceIds, setActiveEvidenceIds] = useState<string[]>([]);
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const claims = useMemo(() => allClaims(report), [report]);
  const blockingGaps = [...report.globalGaps, ...report.findings.flatMap((finding) => finding.gaps)].filter((gap) => gap.severity === "blocking");
  const readyFindings = report.findings.filter((finding) => finding.readiness === "ready").length;
  const visibleBlockingGaps = hasReviewed ? blockingGaps : [];
  const visibleReadyFindings = hasReviewed ? readyFindings : 0;

  function updateProject<K extends keyof ProjectDetails>(key: K, value: ProjectDetails[K]) {
    setProject((current) => ({ ...current, [key]: value }));
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).slice(0, Math.max(0, 10 - artifacts.length));
    const nextArtifacts: EvidenceArtifact[] = [];

    for (const file of files) {
      const kind = inferEvidenceKind(file.name, file.type);
      const base = {
        id: `file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        kind,
        type: file.type || "unknown",
        size: file.size
      };

      if (["text", "json", "xml", "notes", "unknown"].includes(kind)) {
        nextArtifacts.push({ ...base, content: (await file.text()).slice(0, 160000) });
      } else if (kind === "image") {
        nextArtifacts.push({ ...base, preview: await fileToDataUrl(file), content: `Screenshot artifact uploaded: ${file.name}` });
      } else {
        nextArtifacts.push({ ...base, content: `PDF artifact uploaded: ${file.name}` });
      }
    }

    setArtifacts((current) => [...current, ...nextArtifacts].slice(0, 10));
    setHasReviewed(false);
  }

  async function runVerricReview() {
    if (chunks.length === 0) {
      setError("Add evidence files or manual notes before running Verric Review.");
      setStep("evidence");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, artifacts, chunks })
      });
      if (!response.ok) throw new Error("Verric review failed");
      const data = (await response.json()) as { report: VerricReport; mode: GenerationMode };
      setReport(validateReport(data.report, chunks, project));
      setMode(data.mode || "openai");
      setHasReviewed(true);
      setStep("review");
    } catch {
      setError("OpenAI review failed, so Verric loaded the deterministic demo review. Check API key/network and try again.");
      setReport(validateReport(createMockReport(chunks, project), chunks, project));
      setMode("mock");
      setHasReviewed(true);
      setStep("review");
    } finally {
      setIsGenerating(false);
    }
  }

  async function exportReport(format: "pdf" | "docx" | "txt") {
    setIsExporting(format);
    try {
      if (format === "txt") {
        downloadBlob(new Blob([renderPlainTextReport(report, chunks)], { type: "text/plain" }), "verric-report.txt");
        return;
      }
      const response = await fetch(`/api/export-${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, chunks, artifacts })
      });
      if (!response.ok) throw new Error(`Export ${format} failed`);
      const blob = await response.blob();
      downloadBlob(blob, `verric-${project.clientName || "client"}-report.${format}`.replaceAll(" ", "-"));
    } catch {
      setError(`Export ${format.toUpperCase()} failed. Try TXT export or rebuild after dependency install.`);
    } finally {
      setIsExporting(null);
    }
  }

  function selectClaim(claim: ReportClaim) {
    setActiveClaimId(claim.id);
    setActiveEvidenceIds(claim.evidenceIds);
  }

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1540px] border-x border-rule bg-paper/70">
        <header className="flex flex-wrap items-center justify-between gap-4 border-y border-rule px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 bg-verric" />
            <span className="font-mono text-xs font-bold uppercase tracking-[0.26em]">Verric</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-muted">AI reporting studio · proof before polish</div>
          <button onClick={runVerricReview} disabled={isGenerating || chunks.length === 0} className="bg-verric px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-paper transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50">
            {isGenerating ? "Reviewing Evidence..." : "Run Verric Review"}
          </button>
        </header>

        <section className="grid gap-0 border-b border-rule lg:grid-cols-[330px_1fr_360px]">
          <aside className="border-b border-rule p-5 lg:border-b-0 lg:border-r">
            <SectionLabel>Workflow</SectionLabel>
            <div className="mt-5 space-y-2">
              {steps.map((item) => (
                <button key={item.id} onClick={() => setStep(item.id)} className={cx("flex w-full items-center justify-between border px-4 py-3 text-left transition", step === item.id ? "border-ink bg-ink text-paper" : "border-rule bg-paper hover:bg-panel")}>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em]">{item.label}</span>
                  <span className="text-sm font-semibold">{item.title}</span>
                </button>
              ))}
            </div>

            <div className="mt-6 border border-rule bg-panel p-4">
              <SectionLabel>Verric Status</SectionLabel>
              <p className={cx("mt-4 font-serifdeck text-4xl font-semibold", hasReviewed ? severityClass(report.reportReadiness) : "text-warn")}>{hasReviewed ? readinessLabel(report.reportReadiness) : "Awaiting Review"}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{hasReviewed ? report.readinessSummary : "Add project details and upload evidence, then run Verric Review to check missing proof before report generation."}</p>
              <div className="mt-5 grid grid-cols-3 border border-rule text-center">
                <div className="p-3"><p className="font-serifdeck text-3xl font-semibold text-good">{visibleReadyFindings}</p><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Ready</p></div>
                <div className="border-x border-rule p-3"><p className="font-serifdeck text-3xl font-semibold text-verric">{visibleBlockingGaps.length}</p><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Gaps</p></div>
                <div className="p-3"><p className="font-serifdeck text-3xl font-semibold">{artifacts.length}</p><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Files</p></div>
              </div>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Mode: {hasReviewed ? mode : "not run"}</p>
            </div>
          </aside>

          <section className="min-h-[720px] p-5 sm:p-8 lg:p-10">
            {step === "setup" ? (
              <div>
                <SectionLabel>Project Setup</SectionLabel>
                <h1 className="mt-5 max-w-4xl font-serifdeck text-6xl font-semibold leading-[0.92] tracking-[-0.04em] sm:text-8xl">Build the report brief before the AI writes.</h1>
                <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">Verric needs scope, dates, methodology, and tester context so the exported PDF/DOCX feels like a real consulting deliverable.</p>
                <div className="mt-8 grid gap-5 md:grid-cols-2">
                  <Field label="Client Name" value={project.clientName} onChange={(value) => updateProject("clientName", value)} />
                  <Field label="Project Name" value={project.projectName} onChange={(value) => updateProject("projectName", value)} />
                  <Field label="Assessment Type" value={project.assessmentType} onChange={(value) => updateProject("assessmentType", value)} />
                  <Field label="Prepared By" value={project.preparedBy} onChange={(value) => updateProject("preparedBy", value)} />
                  <Field label="Tester Name" value={project.testerName} onChange={(value) => updateProject("testerName", value)} />
                  <Field label="Classification" value={project.classification} onChange={(value) => updateProject("classification", value)} />
                  <Field label="Start Date" value={project.startDate} onChange={(value) => updateProject("startDate", value)} />
                  <Field label="End Date" value={project.endDate} onChange={(value) => updateProject("endDate", value)} />
                  <div className="md:col-span-2"><Field label="Scope" value={project.scope} multiline onChange={(value) => updateProject("scope", value)} /></div>
                  <div className="md:col-span-2"><Field label="Out of Scope" value={project.outOfScope} multiline onChange={(value) => updateProject("outOfScope", value)} /></div>
                  <div className="md:col-span-2"><Field label="Methodology" value={project.methodology} multiline onChange={(value) => updateProject("methodology", value)} /></div>
                  <div className="md:col-span-2"><Field label="Tools Used" value={project.toolsUsed} multiline onChange={(value) => updateProject("toolsUsed", value)} /></div>
                </div>
              </div>
            ) : null}

            {step === "evidence" ? (
              <div>
                <SectionLabel>Evidence Intake</SectionLabel>
                <h2 className="mt-5 font-serifdeck text-6xl font-semibold leading-none">Drop the raw mess.</h2>
                <p className="mt-4 max-w-2xl text-muted">Attach up to 10 artifacts. Verric parses text files, treats screenshots/PDFs as evidence artifacts, and asks for missing proof before report export.</p>
                <p className="mt-3 max-w-2xl border-l-2 border-verric bg-softred/40 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                  Complete demo pack path: /home/edneam/zerric/demo-complete-evidence-pack
                </p>
                <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => event.target.files && handleFiles(event.target.files)} />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleFiles(event.dataTransfer.files);
                  }}
                  className="mt-8 flex min-h-[220px] w-full flex-col items-center justify-center border border-dashed border-verric bg-softred/45 p-8 text-center transition hover:bg-softred"
                >
                  <span className="font-serifdeck text-5xl font-semibold">Drop files here</span>
                  <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-muted">or click to select · max 10 files</span>
                  <span className="mt-4 max-w-xl text-sm text-muted">nmap, Burp, HAR, JSON, XML, logs, screenshots, PDFs, Markdown notes, terminal output</span>
                </button>
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {artifacts.length === 0 ? <p className="border border-rule bg-panel p-5 text-sm text-muted md:col-span-2">No evidence attached yet. For the demo video, drag the files from <span className="font-mono text-ink">demo-complete-evidence-pack</span> into the drop zone, then run Verric Review.</p> : null}
                  {artifacts.map((artifact) => (
                    <div key={artifact.id} className="border border-rule bg-paper p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{artifact.name}</p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{artifact.kind} · {(artifact.size / 1024).toFixed(1)} KB</p>
                        </div>
                        <button onClick={() => setArtifacts((current) => current.filter((item) => item.id !== artifact.id))} className="font-mono text-[10px] uppercase tracking-[0.18em] text-verric">Remove</button>
                      </div>
                      {artifact.preview ? <img src={artifact.preview} alt="Evidence preview" className="mt-3 max-h-40 border border-rule object-cover" /> : <ArtifactPreview artifact={artifact} />}
                    </div>
                  ))}
                </div>
                <div className="mt-6">
                  <Field label="Manual Notes" value={manualNotes} multiline onChange={setManualNotes} placeholder="Paste rough notes, reproduction steps, hypotheses, or client context..." />
                </div>
              </div>
            ) : null}

            {step === "review" ? (
              <div>
                <SectionLabel>Verric Review Layer</SectionLabel>
                <h2 className="mt-5 font-serifdeck text-6xl font-semibold leading-none">What is missing before this ships?</h2>
                <p className="mt-4 max-w-3xl text-muted">This is Verric’s core layer. AI reviews the evidence and tells the tester what proof, PoC, assets, CVSS rationale, or project details are missing before the final report is generated.</p>
                {error ? <p className="mt-5 border border-verric bg-softred p-4 text-sm text-verric">{error}</p> : null}
                {!hasReviewed ? <div className="mt-6 border border-warn bg-panel p-5"><p className="font-serifdeck text-3xl font-semibold text-warn">Review has not run yet.</p><p className="mt-2 text-sm text-muted">Click Run Verric Review after adding evidence. This is where AI checks what PoC/details are missing.</p></div> : null}
                {hasReviewed && report.globalGaps.length > 0 ? <div className="mt-6 space-y-3">{report.globalGaps.map((gap) => <GapCard key={gap.id} gap={gap} />)}</div> : null}
                {hasReviewed ? <div className="mt-7 space-y-5">{report.findings.map((finding) => <FindingReviewCard key={finding.id} finding={finding} />)}</div> : null}
              </div>
            ) : null}

            {step === "draft" ? (
              <div>
                <SectionLabel>Report Draft</SectionLabel>
                <h2 className="mt-5 font-serifdeck text-6xl font-semibold leading-none">Client-ready report draft.</h2>
                {!hasReviewed ? <div className="mt-6 border border-warn bg-panel p-5"><p className="font-serifdeck text-3xl font-semibold text-warn">Run Verric Review first.</p><p className="mt-2 text-sm text-muted">The draft appears only after evidence has been uploaded and checked by the AI review layer.</p></div> : null}
                {hasReviewed ? <>
                <div className="mt-8 border-b border-rule pb-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">{project.classification}</p>
                  <h3 className="mt-2 font-serifdeck text-5xl font-semibold leading-none">{project.projectName}</h3>
                  <p className="mt-2 text-muted">Prepared for {project.clientName} by {project.preparedBy}</p>
                </div>
                <section className="mt-7">
                  <SectionLabel>Executive Summary</SectionLabel>
                  <div className="mt-4 space-y-2">{report.executiveSummary.map((claim) => <ClaimBlock key={claim.id} claim={claim} active={activeClaimId === claim.id} onSelect={selectClaim} />)}</div>
                </section>
                <section className="mt-8">
                  <SectionLabel>Findings Summary</SectionLabel>
                  <div className="mt-4 overflow-hidden border border-rule">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted"><tr className="border-b border-rule"><th className="p-3">ID</th><th className="p-3">Finding</th><th className="p-3">Severity</th><th className="p-3">Readiness</th></tr></thead>
                      <tbody>{report.findings.map((finding) => <tr key={finding.id} className="border-b border-rule last:border-b-0"><td className="p-3 font-mono text-xs font-bold text-verric">{finding.id}</td><td className="p-3 font-semibold">{finding.title}</td><td className={cx("p-3 font-semibold", severityClass(finding.severity))}>{finding.severity}</td><td className="p-3">{readinessLabel(finding.readiness)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
                <section className="mt-8 space-y-5">
                  <SectionLabel>Detailed Findings</SectionLabel>
                  {report.findings.map((finding) => (
                    <article key={finding.id} className="border border-rule bg-paper p-5">
                      <div className="flex flex-wrap justify-between gap-4 border-b border-rule pb-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-verric">{finding.id}</p><h4 className="mt-2 font-serifdeck text-4xl font-semibold">{finding.title}</h4></div><div><p className={cx("font-serifdeck text-4xl font-semibold", severityClass(finding.severity))}>{finding.severity}</p><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">CVSS {finding.cvss}</p></div></div>
                      <div className="mt-4 grid gap-5 md:grid-cols-2"><div><SectionLabel>Description</SectionLabel><div className="mt-3 space-y-2">{finding.description.map((claim) => <ClaimBlock key={claim.id} claim={claim} active={activeClaimId === claim.id} onSelect={selectClaim} />)}</div></div><div><SectionLabel>Proof of Concept</SectionLabel><div className="mt-3 space-y-2">{finding.proofOfConcept.map((claim) => <ClaimBlock key={claim.id} claim={claim} active={activeClaimId === claim.id} onSelect={selectClaim} />)}</div></div><div><SectionLabel>Impact</SectionLabel><div className="mt-3 space-y-2">{finding.impact.map((claim) => <ClaimBlock key={claim.id} claim={claim} active={activeClaimId === claim.id} onSelect={selectClaim} />)}</div></div><div><SectionLabel>Remediation</SectionLabel><div className="mt-3 space-y-2">{finding.remediation.map((claim) => <ClaimBlock key={claim.id} claim={claim} active={activeClaimId === claim.id} onSelect={selectClaim} />)}</div></div></div>
                    </article>
                  ))}
                </section>
                </> : null}
              </div>
            ) : null}

            {step === "export" ? (
              <div>
                <SectionLabel>Export</SectionLabel>
                <h2 className="mt-5 font-serifdeck text-6xl font-semibold leading-none">Ship the deliverable.</h2>
                <p className="mt-4 max-w-2xl text-muted">Export a polished PDF for clients, editable DOCX for consultants, or TXT for quick sharing. Verric warns if missing PoC remains.</p>
                {!hasReviewed ? <div className="mt-6 border border-warn bg-panel p-5"><p className="font-serifdeck text-3xl font-semibold text-warn">Run Verric Review first</p><p className="mt-2 text-sm text-muted">Exports are available after the AI layer checks missing PoC and drafts the report.</p></div> : visibleBlockingGaps.length > 0 ? <div className="mt-6 border border-verric bg-softred p-5"><p className="font-serifdeck text-3xl font-semibold text-verric">{visibleBlockingGaps.length} blocking gaps remain</p><p className="mt-2 text-sm text-muted">You can still export for demo, but Verric recommends adding the requested proof first.</p></div> : <div className="mt-6 border border-good bg-good/5 p-5 text-good">All findings are ready for export.</div>}
                <div className="mt-8 grid gap-5 md:grid-cols-3">
                  {["pdf", "docx", "txt"].map((format) => (
                    <button key={format} disabled={!hasReviewed} onClick={() => exportReport(format as "pdf" | "docx" | "txt")} className="border border-ink bg-paper p-6 text-left transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50">
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em]">Export {format}</p>
                      <p className="mt-5 font-serifdeck text-4xl font-semibold">{isExporting === format ? "Preparing..." : format.toUpperCase()}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <aside className="border-t border-rule bg-panel/75 p-5 lg:border-l lg:border-t-0">
            <SectionLabel>Evidence Inspector</SectionLabel>
            {!hasReviewed ? <div className="mt-4 border border-rule bg-paper p-4 text-sm leading-relaxed text-muted">Evidence chunks appear here after you submit files and run Verric Review. Until then, the right rail stays clean for the recording flow.</div> : null}
            {hasReviewed ? <div className="mt-4 max-h-[520px] overflow-auto border border-rule bg-[#fbf7ed]">
              {chunks.map((chunk: EvidenceChunk) => {
                const active = activeEvidenceIds.includes(chunk.id);
                return (
                  <button key={chunk.id} onClick={() => setActiveEvidenceIds([chunk.id])} className={cx("grid w-full grid-cols-[78px_1fr] border-b border-rule/70 text-left font-mono text-[11px] leading-relaxed last:border-b-0", active ? "bg-softred" : "hover:bg-panel")}>
                    <span className={cx("border-r border-rule px-2 py-2 font-bold", active ? "text-verric" : "text-muted")}>{chunk.id}</span>
                    <span className="px-3 py-2"><span className="block text-muted">{chunk.artifactName}:{chunk.lineStart}</span>{chunk.text}</span>
                  </button>
                );
              })}
            </div> : null}

            <div className="mt-5 border border-rule bg-paper p-4">
              <SectionLabel>Flagged by Verric</SectionLabel>
              <div className="mt-4 space-y-3">
                {!hasReviewed ? <p className="border border-rule bg-panel p-4 text-sm leading-relaxed text-muted">Flagged claims appear here only after Verric Review runs. This panel is the AI safety layer, not initial placeholder content.</p> : report.flaggedClaims.map((claim) => (
                  <button key={claim.id} onClick={() => setActiveEvidenceIds(claim.relatedEvidenceIds)} className="w-full border-l-2 border-verric bg-softred px-4 py-3 text-left">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-verric">Blocked Claim</p>
                    <p className="mt-2 font-serifdeck text-xl font-semibold leading-tight">{claim.text}</p>
                    <p className="mt-2 text-sm text-muted">{claim.reason}</p>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReceipt,
  emptyProjectDetails,
  type EvidenceChunk,
  type GroundingVerdict,
  type VerricReport
} from "@verric/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./index";

const SAMPLE_CHUNKS: EvidenceChunk[] = [
  {
    id: "ev-001",
    artifactId: "a1",
    artifactName: "a.txt",
    lineStart: 1,
    lineEnd: 1,
    text: "alpha"
  },
  {
    id: "ev-002",
    artifactId: "a1",
    artifactName: "a.txt",
    lineStart: 2,
    lineEnd: 2,
    text: "bravo"
  }
];

const SAMPLE_REPORT: VerricReport = {
  project: emptyProjectDetails,
  overallRisk: "Medium",
  reportReadiness: "ready",
  readinessSummary: "ok",
  globalGaps: [],
  executiveSummary: [],
  keyRecommendations: [],
  methodology: [],
  findings: [],
  remediationRoadmap: { immediate: [], shortTerm: [], mediumTerm: [], longTerm: [] },
  flaggedClaims: []
};

const SAMPLE_VERDICTS: GroundingVerdict[] = [{ claimId: "c-1", verdict: "supported" }];

let tmp: string;
let stdout: string[];
let stderr: string[];
// vi.spyOn's return type doesn't match a heavily-overloaded
// process.stdout.write signature; storing the spies as `unknown`
// avoids fighting the type system for what is ultimately a test plumbing
// detail.
let stdoutSpy: { mockRestore: () => void };
let stderrSpy: { mockRestore: () => void };

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "verric-cli-"));
  stdout = [];
  stderr = [];
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as never);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as never);
});

afterEach(async () => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  await rm(tmp, { recursive: true, force: true });
});

describe("verric (top-level)", () => {
  it("prints help with no args and exits 0", async () => {
    const code = await runCli([]);
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("verric — evidence-grounded document engine");
  });

  it("prints help on --help and exits 0", async () => {
    const code = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("Usage:");
  });

  it("returns 2 on an unknown command", async () => {
    const code = await runCli(["bogus-command"]);
    expect(code).toBe(2);
    expect(stderr.join("")).toContain("unknown command");
  });

  it("prints version on --version", async () => {
    const code = await runCli(["--version"]);
    expect(code).toBe(0);
    expect(stdout.join("")).toMatch(/verric \d+\.\d+\.\d+/);
  });
});

describe("verric verify — exit codes", () => {
  it("returns 2 when required flags are missing", async () => {
    const code = await runCli(["verify"]);
    expect(code).toBe(2);
    expect(stderr.join("")).toContain("required");
  });

  it("returns 0 for an unmodified receipt", async () => {
    const receipt = buildReceipt({
      providerId: "openai",
      model: "gpt-4o-mini",
      template: "pentest@test",
      promptHashes: { drafter: "abc" },
      evidence: SAMPLE_CHUNKS,
      report: SAMPLE_REPORT,
      verdicts: SAMPLE_VERDICTS,
      signingKey: "test-key"
    });
    await writeFile(`${tmp}/receipt.json`, JSON.stringify(receipt));
    await writeFile(`${tmp}/report.json`, JSON.stringify(SAMPLE_REPORT));
    await writeFile(`${tmp}/evidence.json`, JSON.stringify(SAMPLE_CHUNKS));
    await writeFile(`${tmp}/verdicts.json`, JSON.stringify(SAMPLE_VERDICTS));

    const code = await runCli([
      "verify",
      "--receipt",
      `${tmp}/receipt.json`,
      "--report",
      `${tmp}/report.json`,
      "--evidence",
      `${tmp}/evidence.json`,
      "--verdicts",
      `${tmp}/verdicts.json`,
      "--signing-key",
      "test-key"
    ]);
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("receipt OK");
  });

  it("returns 1 when the report has been tampered with", async () => {
    const receipt = buildReceipt({
      providerId: "openai",
      model: "x",
      template: "pentest@test",
      promptHashes: { drafter: "abc" },
      evidence: SAMPLE_CHUNKS,
      report: SAMPLE_REPORT,
      signingKey: "test-key"
    });
    const tamperedReport = { ...SAMPLE_REPORT, overallRisk: "Critical" } as VerricReport;
    await writeFile(`${tmp}/receipt.json`, JSON.stringify(receipt));
    await writeFile(`${tmp}/report.json`, JSON.stringify(tamperedReport));
    await writeFile(`${tmp}/evidence.json`, JSON.stringify(SAMPLE_CHUNKS));

    const code = await runCli([
      "verify",
      "--receipt",
      `${tmp}/receipt.json`,
      "--report",
      `${tmp}/report.json`,
      "--evidence",
      `${tmp}/evidence.json`,
      "--signing-key",
      "test-key"
    ]);
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("FAILED");
    expect(stderr.join("")).toContain("report");
  });

  it("returns 1 when the wrong signing key is used", async () => {
    const receipt = buildReceipt({
      providerId: "openai",
      model: "x",
      template: "pentest@test",
      promptHashes: { drafter: "abc" },
      evidence: SAMPLE_CHUNKS,
      report: SAMPLE_REPORT,
      signingKey: "right"
    });
    await writeFile(`${tmp}/receipt.json`, JSON.stringify(receipt));
    await writeFile(`${tmp}/report.json`, JSON.stringify(SAMPLE_REPORT));
    await writeFile(`${tmp}/evidence.json`, JSON.stringify(SAMPLE_CHUNKS));

    const code = await runCli([
      "verify",
      "--receipt",
      `${tmp}/receipt.json`,
      "--report",
      `${tmp}/report.json`,
      "--evidence",
      `${tmp}/evidence.json`,
      "--signing-key",
      "wrong"
    ]);
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("signature");
  });
});

describe("verric report — argument validation", () => {
  it("returns 2 when --evidence is missing", async () => {
    const code = await runCli(["report"]);
    expect(code).toBe(2);
    expect(stderr.join("")).toContain("--evidence");
  });

  it("returns 2 when the evidence directory has no readable files", async () => {
    await mkdir(`${tmp}/empty`, { recursive: true });
    const code = await runCli(["report", "--evidence", `${tmp}/empty`]);
    expect(code).toBe(2);
    expect(stderr.join("")).toContain("no readable evidence");
  });
});

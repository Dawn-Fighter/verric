import { describe, expect, it } from "vitest";
import { cvssFromVector } from "./cvss";

// CVSS 3.1 base score is the deterministic core of Verric's trust story.
// Score, vector, and severity are recomputed from the vector inside the
// validate pass so an LLM cannot pick a number that disagrees with its math.
// These tests lock the canonical reference vectors from the prompt + spec.
describe("cvssFromVector", () => {
  describe("invalid input", () => {
    it("returns null for empty string", () => {
      expect(cvssFromVector("")).toBeNull();
    });

    it("returns null for the literal 'N/A'", () => {
      expect(cvssFromVector("N/A")).toBeNull();
    });

    it("returns null for a vector missing the CVSS:3.x prefix", () => {
      expect(cvssFromVector("AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBeNull();
    });

    it("returns null when a required base metric is missing (no Scope)", () => {
      expect(cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/C:H/I:H/A:H")).toBeNull();
    });

    it("returns null when a metric value is unknown", () => {
      expect(cvssFromVector("CVSS:3.1/AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBeNull();
    });
  });

  describe("canonical reference bands (from prompt rules)", () => {
    it("AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H → 9.8 Critical", () => {
      expect(cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toEqual({
        score: 9.8,
        severity: "Critical"
      });
    });

    it("AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N → 8.2 High", () => {
      expect(cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N")).toEqual({
        score: 8.2,
        severity: "High"
      });
    });

    it("AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N → 8.1 High", () => {
      expect(cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N")).toEqual({
        score: 8.1,
        severity: "High"
      });
    });

    it("AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N → 6.5 Medium", () => {
      expect(cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N")).toEqual({
        score: 6.5,
        severity: "Medium"
      });
    });

    it("AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N → 5.3 Medium", () => {
      expect(cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N")).toEqual({
        score: 5.3,
        severity: "Medium"
      });
    });

    it("AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N → 3.7 Low", () => {
      expect(cvssFromVector("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N")).toEqual({
        score: 3.7,
        severity: "Low"
      });
    });

    it("all-None vector yields 0.0 Informational", () => {
      expect(cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")).toEqual({
        score: 0,
        severity: "Informational"
      });
    });
  });

  describe("scope-changed (S:C) path", () => {
    it("scope-changed amplifies score above unchanged equivalent", () => {
      const unchanged = cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L");
      const changed = cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:L");
      expect(unchanged).not.toBeNull();
      expect(changed).not.toBeNull();
      expect(changed!.score).toBeGreaterThan(unchanged!.score);
    });
  });

  describe("severity bucket boundaries", () => {
    it.each([
      ["Critical", 9.0, 10.0],
      ["High", 7.0, 8.9],
      ["Medium", 4.0, 6.9],
      ["Low", 0.1, 3.9]
    ])("score in %s band lands in [%s, %s]", (label, low, high) => {
      // Find one vector per band from the canonical examples.
      const vectorsByLabel: Record<string, string> = {
        Critical: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        High: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N",
        Medium: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N",
        Low: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N"
      };
      const result = cvssFromVector(vectorsByLabel[label]);
      expect(result).not.toBeNull();
      expect(result!.severity).toBe(label);
      expect(result!.score).toBeGreaterThanOrEqual(low);
      expect(result!.score).toBeLessThanOrEqual(high);
    });
  });

  describe("CVSS 3.0 prefix is also accepted", () => {
    it("CVSS:3.0 vector parses identically", () => {
      const v30 = cvssFromVector("CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
      const v31 = cvssFromVector("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
      expect(v30).toEqual(v31);
    });
  });
});

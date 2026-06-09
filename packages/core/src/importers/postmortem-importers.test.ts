import { describe, expect, it } from "vitest";
import { githubImporter, pagerdutyImporter, slackImporter } from "./index";
import type { EvidenceArtifact } from "../types";

function art(id: string, content: string, name = `${id}.json`): EvidenceArtifact {
  return {
    id,
    name,
    kind: "json",
    type: "application/json",
    size: content.length,
    content
  };
}

describe("slackImporter", () => {
  it("emits one chunk per message with author + timestamp", () => {
    const exp = JSON.stringify([
      {
        type: "message",
        ts: "1700000001.000100",
        user: "U1",
        user_profile: { display_name: "alice" },
        text: "Search latency spiked"
      },
      {
        type: "message",
        ts: "1700000061.000200",
        user: "U2",
        user_profile: { display_name: "bob" },
        text: "Rolling back the search-api deploy"
      },
      // A noisy join event we expect to skip.
      { type: "message", subtype: "channel_join", user: "U3", text: "<@U3> has joined" }
    ]);
    const a = art("slack", exp, "incident-1234.json");
    expect(slackImporter.detect(a)).toBe(true);
    const chunks = slackImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("alice");
    expect(chunks[0].text).toContain("Search latency spiked");
    expect(chunks[0].text).toContain("Slack #incident-1234");
    expect(chunks[1].text).toContain("bob");
  });

  it("does not detect a non-Slack JSON artifact", () => {
    const a = art("x", JSON.stringify([{ foo: "bar" }]));
    expect(slackImporter.detect(a)).toBe(false);
  });
});

describe("pagerdutyImporter", () => {
  it("parses a single incident object", () => {
    const json = JSON.stringify({
      incident: {
        incident_number: 876,
        title: "Search degraded",
        status: "triggered",
        urgency: "high",
        service: { summary: "search-api" },
        created_at: "2026-06-01T12:01:00Z"
      }
    });
    const a = art("pd", json, "pd.json");
    expect(pagerdutyImporter.detect(a)).toBe(true);
    const chunks = pagerdutyImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("PagerDuty #876");
    expect(chunks[0].text).toContain("Search degraded");
    expect(chunks[0].text).toContain("search-api");
  });

  it("parses an incidents-list response", () => {
    const json = JSON.stringify({
      incidents: [
        { incident_number: 1, title: "A", status: "triggered", urgency: "high" },
        { incident_number: 2, title: "B", status: "resolved", urgency: "low" }
      ]
    });
    const a = art("pd", json);
    const chunks = pagerdutyImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(2);
  });
});

describe("githubImporter", () => {
  it("parses a list of commits", () => {
    const json = JSON.stringify([
      {
        sha: "abc123def456789",
        commit: { message: "fix: cache eviction policy\n\nDetails…", author: { name: "alice" } },
        author: { login: "alice" }
      },
      {
        sha: "xyz000",
        commit: { message: "feat: new query path", author: { name: "bob" } }
      }
    ]);
    const a = art("gh", json, "commits.json");
    expect(githubImporter.detect(a)).toBe(true);
    const chunks = githubImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("GitHub commit");
    expect(chunks[0].text).toContain("fix: cache eviction policy");
  });

  it("parses a list of pull requests", () => {
    const json = JSON.stringify([
      {
        number: 42,
        title: "Add cache eviction guard",
        state: "merged",
        merged_at: "2026-06-01T13:00:00Z",
        user: { login: "alice" },
        html_url: "https://github.com/o/r/pull/42"
      }
    ]);
    const a = art("gh", json);
    expect(githubImporter.detect(a)).toBe(true);
    const chunks = githubImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("GitHub PR #42");
    expect(chunks[0].text).toContain("Add cache eviction guard");
  });

  it("parses an issue (no pull_request key)", () => {
    const json = JSON.stringify([
      {
        number: 7,
        title: "Search latency on deploy",
        state: "open",
        user: { login: "carol" }
      }
    ]);
    const a = art("gh", json);
    expect(githubImporter.detect(a)).toBe(false); // no commit/pr markers
    // But via direct call still emits issue chunks.
    const chunks = githubImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("GitHub issue #7");
  });
});

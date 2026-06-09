import { describe, expect, it } from "vitest";
import { extractJson } from "./json";

// extractJson normalizes LLM output before JSON.parse. It is the very first
// thing that runs on a model response, so a regression here can corrupt the
// entire report pipeline. Lock its behavior precisely.

describe("extractJson", () => {
  it("returns plain JSON unchanged (modulo trim)", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("trims surrounding whitespace", () => {
    expect(extractJson('   \n  {"a":1}\n   ')).toBe('{"a":1}');
  });

  it("strips a leading ```json fence (case-insensitive)", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('```JSON\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips a leading bare ``` fence", () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("slices to the outermost braces, dropping leading prose", () => {
    expect(extractJson('Here is your JSON:\n{"a":1}')).toBe('{"a":1}');
  });

  it("slices to the outermost braces, dropping trailing prose", () => {
    expect(extractJson('{"a":1}\nHope this helps!')).toBe('{"a":1}');
  });

  it("slices on the LAST closing brace (handles nested objects)", () => {
    expect(extractJson('prefix {"a":{"b":1}} suffix')).toBe('{"a":{"b":1}}');
  });

  it("returns the cleaned input verbatim when no braces are found", () => {
    expect(extractJson("not json at all")).toBe("not json at all");
  });

  it("returns the cleaned input verbatim when only an opening brace is found", () => {
    // No closing brace → start !== -1, end === -1 (lastIndexOf returns -1) → return cleaned.
    // Lock current behavior even though it's an unhappy path.
    expect(extractJson("{ unfinished")).toBe("{ unfinished");
  });

  it("handles a fenced response with prose around it", () => {
    const noisy = '```json\nFinal answer:\n{"verdicts":[]}\n```';
    expect(extractJson(noisy)).toBe('{"verdicts":[]}');
  });
});

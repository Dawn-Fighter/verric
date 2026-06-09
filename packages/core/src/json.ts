// Tiny, dependency-free helper for normalizing LLM JSON output.
//
// Models occasionally wrap JSON in ```json fences``` or add prose around
// it. This is a best-effort cleanup before JSON.parse — it does NOT
// validate that the result is well-formed JSON; that's the caller's job.

export function extractJson(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return cleaned;
  return cleaned.slice(start, end + 1);
}

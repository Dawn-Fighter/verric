// Tiny argv shape used across commands. We use Node's built-in
// util.parseArgs rather than pulling in commander/yargs — fewer deps,
// fewer cross-platform surprises, and the surface area is small.

import { parseArgs as nodeParseArgs } from "node:util";

export interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean | undefined>;
  positionals: string[];
}

export function parseArgs(
  argv: string[],
  flagSpec: Record<string, { type: "string" | "boolean"; short?: string }>
): ParsedArgs {
  const [command, ...rest] = argv;
  const options: Record<string, { type: "string" | "boolean"; short?: string }> = {};
  for (const [name, spec] of Object.entries(flagSpec)) {
    options[name] = spec;
  }
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options,
    strict: false,
    allowPositionals: true
  });
  return {
    command: command ?? "",
    flags: values as Record<string, string | boolean | undefined>,
    positionals
  };
}

/** Resolve a flag, allowing env-var fallback for sensitive defaults. */
export function flagOrEnv(
  flags: Record<string, string | boolean | undefined>,
  flagName: string,
  envName: string
): string | undefined {
  const v = flags[flagName];
  if (typeof v === "string" && v.length > 0) return v;
  const e = process.env[envName];
  return e && e.length > 0 ? e : undefined;
}

// Default importer registry — every built-in importer auto-registers
// here. To turn an importer off in a custom embed, pass a fresh
// ImporterRegistry to buildEvidenceChunks instead of the default.

import { ImporterRegistry } from "./types";
import { nmapImporter } from "./nmap";
import { burpImporter } from "./burp";
import { nessusImporter } from "./nessus";
import { nucleiImporter } from "./nuclei";
import { zapImporter } from "./zap";
import { openvasImporter } from "./openvas";
import { slackImporter } from "./slack";
import { pagerdutyImporter } from "./pagerduty";
import { githubImporter } from "./github";

export { ImporterRegistry, formatChunkId } from "./types";
export type { Importer, ImporterContext } from "./types";
export { nmapImporter } from "./nmap";
export { burpImporter } from "./burp";
export { nessusImporter } from "./nessus";
export { nucleiImporter } from "./nuclei";
export { zapImporter } from "./zap";
export { openvasImporter } from "./openvas";
export { slackImporter } from "./slack";
export { pagerdutyImporter } from "./pagerduty";
export { githubImporter } from "./github";

export function defaultImporterRegistry(): ImporterRegistry {
  return new ImporterRegistry().registerMany([
    // Pentest scanners (run first; their detectors are more specific)
    nmapImporter,
    burpImporter,
    nessusImporter,
    nucleiImporter,
    zapImporter,
    openvasImporter,
    // Postmortem signal sources
    slackImporter,
    pagerdutyImporter,
    githubImporter
  ]);
}

import { describe, expect, it } from "vitest";
import {
  burpImporter,
  defaultImporterRegistry,
  ImporterRegistry,
  nessusImporter,
  nmapImporter,
  nucleiImporter,
  openvasImporter,
  zapImporter
} from "./index";
import { buildEvidenceChunks } from "../chunks";
import type { EvidenceArtifact } from "../types";

function art(id: string, content: string, name = `${id}.txt`): EvidenceArtifact {
  return {
    id,
    name,
    kind: "text",
    type: "text/plain",
    size: content.length,
    content
  };
}

describe("ImporterRegistry", () => {
  it("registers, replaces by id (idempotent), and lists in insertion order", () => {
    const reg = new ImporterRegistry();
    reg.register(nmapImporter);
    reg.register(nmapImporter); // duplicate id replaces, doesn't append
    reg.register(burpImporter);
    expect(reg.list().map((i) => i.id)).toEqual(["nmap", "burp"]);
  });

  it("findMatch returns the first importer that detects the artifact", () => {
    const reg = defaultImporterRegistry();
    const a = art("a", "Nmap scan report for 10.0.0.1\nPORT     STATE SERVICE\n22/tcp open ssh");
    expect(reg.findMatch(a)?.id).toBe("nmap");
  });

  it("findMatch returns undefined when no importer matches", () => {
    const reg = defaultImporterRegistry();
    const a = art("a", "Just some plain prose with no scanner output.");
    expect(reg.findMatch(a)).toBeUndefined();
  });
});

describe("nmapImporter", () => {
  it("emits one structured chunk per port", () => {
    const a = art(
      "scan",
      `Nmap scan report for 10.10.10.5
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2
80/tcp   open  http    Apache 2.4`
    );
    expect(nmapImporter.detect(a)).toBe(true);
    const chunks = nmapImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("port 22/tcp open ssh");
    expect(chunks[1].text).toContain("port 80/tcp open http");
  });
});

describe("burpImporter", () => {
  it("parses a Burp <issues> XML export", () => {
    const xml = `<?xml version="1.0"?>
<issues>
  <issue>
    <serialNumber>1</serialNumber>
    <name>SQL injection</name>
    <severity>High</severity>
    <host>https://demo.example.com</host>
    <path>/login</path>
    <issueDetail>The username parameter appears to be vulnerable to time-based blind SQL injection.</issueDetail>
  </issue>
  <issue>
    <name>Cross-site scripting</name>
    <severity>Medium</severity>
    <host>https://demo.example.com</host>
    <path>/search</path>
  </issue>
</issues>`;
    const a = art("burp", xml, "burp-issues.xml");
    expect(burpImporter.detect(a)).toBe(true);
    const chunks = burpImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("SQL injection");
    expect(chunks[0].text).toContain("[High]");
    expect(chunks[0].text).toContain("https://demo.example.com");
    expect(chunks[1].text).toContain("Cross-site scripting");
  });

  it("parses a raw HTTP request/response capture", () => {
    const http = `Request: GET /admin HTTP/1.1
Host: demo.example.com

Response: HTTP/1.1 200 OK
Body: Admin dashboard loaded successfully.`;
    const a = art("burp", http, "burp-admin.http");
    expect(burpImporter.detect(a)).toBe(true);
    const chunks = burpImporter.importChunks(a, { startIndex: 0 });
    expect(chunks.some((c) => c.text.startsWith("Burp request:"))).toBe(true);
    expect(chunks.some((c) => c.text.startsWith("Burp response:"))).toBe(true);
  });

  it("skips artifacts with no Burp markers", () => {
    expect(burpImporter.detect(art("x", "just some prose"))).toBe(false);
  });
});

describe("nessusImporter", () => {
  it("parses a NessusClientData export", () => {
    const xml = `<?xml version="1.0"?>
<NessusClientData_v2>
  <Report>
    <ReportHost name="10.10.10.5">
      <ReportItem port="22" protocol="tcp" severity="3" pluginName="OpenSSH 7.2 weak ciphers">
        <synopsis>Weak encryption ciphers are supported.</synopsis>
      </ReportItem>
      <ReportItem port="3306" protocol="tcp" severity="2" pluginName="MySQL service detected">
        <synopsis>An unauthenticated MySQL service is listening.</synopsis>
      </ReportItem>
    </ReportHost>
  </Report>
</NessusClientData_v2>`;
    const a = art("nessus", xml, "scan.nessus");
    expect(nessusImporter.detect(a)).toBe(true);
    const chunks = nessusImporter.importChunks(a, { startIndex: 5 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].id).toBe("ev-006"); // continues from startIndex
    expect(chunks[0].text).toContain("10.10.10.5");
    expect(chunks[0].text).toContain("[High]");
    expect(chunks[0].text).toContain("OpenSSH 7.2 weak ciphers");
    expect(chunks[1].text).toContain("[Medium]");
  });
});

describe("nucleiImporter", () => {
  it("parses JSONL output (one finding per line)", () => {
    const jsonl = [
      JSON.stringify({
        "template-id": "exposed-panels/jenkins",
        info: { name: "Jenkins panel exposed", severity: "medium" },
        host: "https://10.10.10.5"
      }),
      JSON.stringify({
        "template-id": "default-logins/jboss",
        info: { name: "JBoss default credentials", severity: "high" },
        host: "https://10.10.10.5:8080"
      })
    ].join("\n");
    const a = art("nuclei", jsonl, "nuclei.jsonl");
    expect(nucleiImporter.detect(a)).toBe(true);
    const chunks = nucleiImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("Jenkins panel exposed");
    expect(chunks[1].text).toContain("[high]");
  });

  it("parses a JSON array variant", () => {
    const json = JSON.stringify([
      {
        "template-id": "exposed/.git",
        info: { name: ".git directory exposed", severity: "low" },
        host: "https://demo.example.com"
      }
    ]);
    const a = art("nuclei", json, "nuclei.json");
    expect(nucleiImporter.detect(a)).toBe(true);
    const chunks = nucleiImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain(".git directory exposed");
  });

  it("ignores garbage lines in JSONL", () => {
    const jsonl = `{"template-id":"x","info":{"name":"OK","severity":"info"},"host":"h"}\nnot json\n{"template-id":"y","info":{"name":"OK2","severity":"info"},"host":"h"}`;
    const a = art("nuclei", jsonl, "nuclei.jsonl");
    expect(nucleiImporter.importChunks(a, { startIndex: 0 })).toHaveLength(2);
  });
});

describe("zapImporter", () => {
  it("parses a ZAP JSON report", () => {
    const json = JSON.stringify({
      site: [
        {
          "@host": "demo.example.com",
          alerts: [
            {
              alert: "SQL Injection",
              riskdesc: "High (Medium)",
              instances: [{ method: "POST", uri: "https://demo.example.com/login" }]
            },
            {
              alert: "X-Frame-Options Header Missing",
              riskdesc: "Medium",
              instances: [{ method: "GET", uri: "https://demo.example.com/" }]
            }
          ]
        }
      ]
    });
    const a = art("zap", json, "zap-report.json");
    expect(zapImporter.detect(a)).toBe(true);
    const chunks = zapImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("SQL Injection");
    expect(chunks[0].text).toContain("POST");
    expect(chunks[1].text).toContain("X-Frame-Options Header Missing");
  });
});

describe("openvasImporter", () => {
  it("parses a Greenbone GVM report", () => {
    const xml = `<get_reports_response>
  <report>
    <result>
      <host>10.0.0.1</host>
      <port>22/tcp</port>
      <threat>Medium</threat>
      <severity>5.0</severity>
      <nvt><name>SSH Weak MAC Algorithms</name></nvt>
    </result>
    <result>
      <host>10.0.0.1</host>
      <port>443/tcp</port>
      <threat>High</threat>
      <severity>7.5</severity>
      <nvt><name>SSL/TLS Heartbleed</name></nvt>
    </result>
  </report>
</get_reports_response>`;
    const a = art("openvas", xml, "report.xml");
    expect(openvasImporter.detect(a)).toBe(true);
    const chunks = openvasImporter.importChunks(a, { startIndex: 0 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("SSH Weak MAC Algorithms");
    expect(chunks[0].text).toContain("[Medium]");
    expect(chunks[1].text).toContain("Heartbleed");
    expect(chunks[1].text).toContain("[High]");
  });
});

describe("buildEvidenceChunks integration with the registry", () => {
  it("emits structured chunks before raw-line chunks", () => {
    const nmap = `Nmap scan report for 10.10.10.5
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2`;
    const result = buildEvidenceChunks(
      [{ id: "f", name: "scan.txt", kind: "text", type: "text/plain", size: nmap.length, content: nmap }],
      ""
    );
    // Structured chunk(s) first, then raw lines.
    expect(result[0].text.startsWith("Nmap:")).toBe(true);
    expect(result.some((c) => c.text.startsWith("Nmap scan report"))).toBe(true);
  });

  it("respects custom registries (e.g. opt out of an importer)", () => {
    const reg = new ImporterRegistry(); // empty
    const nmap = `Nmap scan report for 10.10.10.5
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2`;
    const result = buildEvidenceChunks(
      [{ id: "f", name: "scan.txt", kind: "text", type: "text/plain", size: nmap.length, content: nmap }],
      "",
      { importers: reg }
    );
    expect(result.some((c) => c.text.startsWith("Nmap:"))).toBe(false);
    // Raw chunks still emitted.
    expect(result.some((c) => c.text.includes("22/tcp"))).toBe(true);
  });

  it("invokes the first matching importer for each artifact", () => {
    const burpXml = `<issues><issue><name>SQL injection</name><severity>High</severity><host>demo</host><path>/x</path></issue></issues>`;
    const result = buildEvidenceChunks(
      [
        {
          id: "f",
          name: "burp.xml",
          kind: "xml",
          type: "application/xml",
          size: burpXml.length,
          content: burpXml
        }
      ],
      ""
    );
    expect(result.some((c) => c.text.includes("Burp issue:"))).toBe(true);
  });
});

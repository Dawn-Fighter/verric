import { describe, expect, it } from "vitest";
import { isNmapContent, parseNmap } from "./nmap";

// The nmap parser is the prototype for "structured importers": a raw text
// blob → typed records the LLM can ground claims to. Locking its behavior
// before we generalize the importer interface in Phase 1.

const SAMPLE_NMAP = `Starting Nmap 7.94 ( https://nmap.org )
Nmap scan report for demo.example.com (10.10.10.5)
Host is up (0.012s latency).
Not shown: 997 closed tcp ports
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2 Ubuntu
80/tcp   open  http    Apache httpd 2.4.18
3306/tcp open  mysql   MySQL 5.7.31

Nmap done: 1 IP address (1 host up) scanned in 0.42 seconds`;

const SAMPLE_BARE_IP = `Nmap scan report for 10.10.10.5
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2`;

describe("isNmapContent", () => {
  it("detects the standard scan-report header", () => {
    expect(isNmapContent(SAMPLE_NMAP)).toBe(true);
  });

  it("detects the PORT/STATE/SERVICE table header", () => {
    const onlyTable = `PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH`;
    expect(isNmapContent(onlyTable)).toBe(true);
  });

  it("returns false for empty input", () => {
    expect(isNmapContent("")).toBe(false);
  });

  it("returns false for arbitrary text", () => {
    expect(isNmapContent("This is just some notes about a finding.")).toBe(false);
  });

  it("returns false when the header is present but no port table appears", () => {
    expect(isNmapContent("Nmap scan report for example.com\nNo open ports found.")).toBe(false);
  });
});

describe("parseNmap", () => {
  it("returns an empty array for empty input", () => {
    expect(parseNmap("")).toEqual([]);
  });

  it("parses a host with hostname + IP and three ports", () => {
    const hosts = parseNmap(SAMPLE_NMAP);
    expect(hosts).toHaveLength(1);
    const host = hosts[0];
    expect(host.host).toBe("demo.example.com");
    expect(host.ip).toBe("10.10.10.5");
    expect(host.ports).toHaveLength(3);
    expect(host.ports[0]).toEqual({
      port: 22,
      proto: "tcp",
      state: "open",
      service: "ssh",
      version: "OpenSSH 7.2p2 Ubuntu"
    });
    expect(host.ports[1]).toEqual({
      port: 80,
      proto: "tcp",
      state: "open",
      service: "http",
      version: "Apache httpd 2.4.18"
    });
    expect(host.ports[2]).toEqual({
      port: 3306,
      proto: "tcp",
      state: "open",
      service: "mysql",
      version: "MySQL 5.7.31"
    });
  });

  it("handles a bare-IP scan report (no parenthesized address)", () => {
    const hosts = parseNmap(SAMPLE_BARE_IP);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].ip).toBe("10.10.10.5");
    expect(hosts[0].ports).toHaveLength(1);
  });

  it("skips a host that has no ports listed", () => {
    const noPorts = `Nmap scan report for example.com (10.0.0.1)
Host is up.`;
    expect(parseNmap(noPorts)).toEqual([]);
  });

  it("captures ports without version strings", () => {
    const noVersion = `Nmap scan report for 10.0.0.1
PORT     STATE SERVICE VERSION
22/tcp   open  ssh`;
    const hosts = parseNmap(noVersion);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].ports[0]).toMatchObject({
      port: 22,
      proto: "tcp",
      state: "open",
      service: "ssh",
      version: ""
    });
  });

  it("parses multiple hosts in one document", () => {
    const multi = `Nmap scan report for host-a (10.0.0.1)
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.0

Nmap scan report for host-b (10.0.0.2)
PORT     STATE SERVICE VERSION
443/tcp  open  https   nginx 1.20`;
    const hosts = parseNmap(multi);
    expect(hosts).toHaveLength(2);
    expect(hosts[0].ip).toBe("10.0.0.1");
    expect(hosts[1].ip).toBe("10.0.0.2");
  });
});

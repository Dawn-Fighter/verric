// Nmap plain-text parser — turns -sV output into structured Hosts/Services.
// Targets the classic "PORT STATE SERVICE VERSION" table.
//
// This is the prototype for Verric's Importer pattern: a raw text blob
// becomes typed records the LLM can ground claims to.

export type NmapPort = {
  port: number;
  proto: string;
  state: string;
  service: string;
  version: string;
};

export type NmapHost = {
  host: string;
  ip: string;
  ports: NmapPort[];
};

export function isNmapContent(content: string): boolean {
  if (!content) return false;
  const head = content.slice(0, 4000);
  return /Nmap scan report|^PORT\s+STATE\s+SERVICE/im.test(head) && /\b\d{1,5}\/(tcp|udp)\b/.test(head);
}

export function parseNmap(content: string): NmapHost[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const hosts: NmapHost[] = [];
  let current: NmapHost | null = null;
  let inPortTable = false;

  const pushHost = () => {
    if (current && current.ports.length > 0) hosts.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;

    const reportMatch = line.match(/^Nmap scan report for\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/i);
    if (reportMatch) {
      pushHost();
      const left = reportMatch[1].trim();
      const right = reportMatch[2]?.trim();
      // "host (ip)" pattern -> left=host, right=ip; bare IP -> left only
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(left);
      current = {
        host: right ? left : isIp ? left : left,
        ip: right || (isIp ? left : ""),
        ports: []
      };
      inPortTable = false;
      continue;
    }

    if (/^PORT\s+STATE\s+SERVICE/i.test(line.trim())) {
      inPortTable = true;
      continue;
    }

    if (inPortTable) {
      // 22/tcp   open  ssh     OpenSSH 7.2p2 Ubuntu ...
      const portMatch = line.match(/^\s*(\d{1,5})\/(tcp|udp)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/i);
      if (portMatch) {
        if (!current) current = { host: "", ip: "", ports: [] };
        current.ports.push({
          port: Number(portMatch[1]),
          proto: portMatch[2].toLowerCase(),
          state: portMatch[3].toLowerCase(),
          service: portMatch[4],
          version: (portMatch[5] || "").trim()
        });
        continue;
      }
      // table ends on blank or non-matching content
      if (!/^\s/.test(line) && !/^\s*\d/.test(line)) inPortTable = false;
    }
  }

  pushHost();
  return hosts;
}

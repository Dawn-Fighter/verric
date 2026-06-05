import { NextResponse } from "next/server";
import { type EvidenceChunk, type VerricReport, renderPlainTextReport } from "@/lib/report";

export async function POST(request: Request) {
  const { report, chunks } = (await request.json()) as { report: VerricReport; chunks: EvidenceChunk[] };
  return new NextResponse(renderPlainTextReport(report, chunks || []), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="verric-${report.project.clientName || "client"}-report.txt"`
    }
  });
}

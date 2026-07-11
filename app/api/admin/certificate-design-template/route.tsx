import { NextResponse } from "next/server";
import ReactPDF from "@react-pdf/renderer";
import { requireAdmin } from "@/lib/admin-auth";
import { CertificateDesignGuide } from "@/lib/certificates/template";

export const dynamic = "force-dynamic";

// Operator design template: an A4-landscape PDF marking every certificate text
// area (from lib/certificates/layout.ts) as a labeled box. Admins hand this to
// sponsors so custom background designs keep the text areas free. Same guide
// for every chapter and both variants — the text positions are fixed.
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const pdfStream = await ReactPDF.renderToStream(CertificateDesignGuide());

  const chunks: Uint8Array[] = [];
  for await (const chunk of pdfStream) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }

  return new NextResponse(Buffer.concat(chunks), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="EHL-Certificate-Design-Template.pdf"',
      "Cache-Control": "private, no-store",
    },
  });
}

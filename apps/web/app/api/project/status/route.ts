import { NextResponse } from "next/server";
import { getProviderStatus } from "@/lib/llm/provider";
import { verifyLLMProvider } from "@/lib/llm/verification";
export const runtime = "nodejs";
export function GET() { return NextResponse.json(getProviderStatus(), { headers: { "Cache-Control": "no-store" } }); }
export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LLM_VERIFICATION !== "1") {
    return NextResponse.json({ error: "Active provider verification is development-only unless explicitly enabled" }, { status: 403 });
  }
  return NextResponse.json(await verifyLLMProvider(), { headers: { "Cache-Control": "no-store" } });
}

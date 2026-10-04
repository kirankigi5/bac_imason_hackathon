import { NextResponse } from "next/server";
import { converse } from "@/lib/project/conversation";
import { ZodError } from "zod";
import { DecisionError } from "@/lib/backend/decisions";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return NextResponse.json(await converse(await request.json())); }
  catch (error) {
    if (error instanceof DecisionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid project or message; please check the supplied values." }, { status: 400 });
    console.error("Conversation failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Could not evaluate the local feature store. The project has not been changed." }, { status: 500 });
  }
}

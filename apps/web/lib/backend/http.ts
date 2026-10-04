import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DecisionError } from "./decisions";

export async function apiResult(work: () => unknown | Promise<unknown>, status = 200) {
  try { return NextResponse.json(await work(), { status, headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    if (error instanceof DecisionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request schema or JSON" }, { status: 400 });
    console.error("Decision API failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Local decision service unavailable; no project update was committed" }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { cloneProject } from "@/lib/project/defaults";
import { getLLMProvider } from "@/lib/llm/provider";
import { ZodError } from "zod";
import { conversationSchema } from "@/lib/llm/schemas";
import { finalizeIntent } from "@/lib/llm/intent-parser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const validated = conversationSchema.safeParse(await request.json().catch(() => null));
  if (!validated.success) return NextResponse.json({ error: "Invalid message or project profile" }, { status: 400 });
  const currentProject = cloneProject(validated.data.currentProject);
  try {
    const parsed = await getLLMProvider().parseProjectIntent(validated.data.message, currentProject);
    return NextResponse.json({ ...finalizeIntent(parsed.value, currentProject), provider: parsed.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ZodError ? "Requested values are outside the supported schema" : "Could not parse this request" }, { status: 400 });
  }
}

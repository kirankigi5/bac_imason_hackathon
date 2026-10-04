import { CircleHelp, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { FeasibilityStatus as Status } from "@/lib/types/domain";

const definitions = {
  FEASIBLE: { icon: ShieldCheck, color: "text-moss", text: "Observed county-screening requirements passed." },
  CONDITIONALLY_FEASIBLE: { icon: ShieldQuestion, color: "text-saffron", text: "No observed hard failure, but site-specific diligence remains." },
  INSUFFICIENT_DATA: { icon: CircleHelp, color: "text-steel", text: "Required evidence is missing." },
  INFEASIBLE: { icon: ShieldAlert, color: "text-rosewood", text: "A measured hard requirement failed." }
};
export function FeasibilityStatus({ status, description = false }: { status: Status; description?: boolean }) {
  const { icon: Icon, color, text } = definitions[status];
  return <div data-feasibility-status={status} className="min-w-0">
    <span className={`inline-flex max-w-full items-start gap-1.5 text-xs font-bold ${color}`}><Icon className="shrink-0" size={15} /><span className="break-words">{status}</span></span>
    {description ? <p className="mt-1 text-sm text-steel">{text}</p> : null}
  </div>;
}

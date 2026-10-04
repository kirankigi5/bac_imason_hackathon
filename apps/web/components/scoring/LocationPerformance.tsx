import { categoryKeys, type CategoryScores } from "@/lib/types/domain";
import { factorMetadata, locationScore } from "@/lib/frontend/factor-metadata";
import { FactorHelp } from "./FactorHelp";

export function LocationPerformance({ scores }: { scores: CategoryScores }) {
  return <section className="location-performance" aria-label="Location Performance"><h3>Location Performance</h3>
    <dl>{categoryKeys.map((factor) => <div key={factor} data-performance-factor={factor}>
      <dt>{factorMetadata[factor].display_name}</dt><dd><span aria-label={`${factorMetadata[factor].display_name} location score`}>{locationScore(factor, scores[factor])}</span><FactorHelp factor={factor} /></dd>
    </div>)}</dl>
  </section>;
}

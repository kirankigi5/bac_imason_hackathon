export const categoryKeys = [
  "energy",
  "water",
  "climate",
  "infrastructure",
  "economics",
  "approval",
  "community"
] as const;

export type CategoryKey = (typeof categoryKeys)[number];

export type WorkloadType = "AI_TRAINING" | "AI_INFERENCE" | "MIXED" | "CLOUD";

export type Audience = "developer" | "government" | "community";

export type DecisionWeights = Record<CategoryKey, number>;
export type CategoryScores = Record<CategoryKey, number | null>;

export type Geography = {
  country?: "US";
  states?: string[];
  regions?: string[];
};

export type ConstraintOperator = "<" | "<=" | ">" | ">=" | "=";

export type Constraint = {
  id: string;
  label: string;
  metric: string;
  operator: ConstraintOperator;
  value: number | string;
  kind: "hard";
};

export type ProjectState = {
  capacityMw?: number;
  workloadType?: WorkloadType;
  geography?: Geography;
  targetGoLiveYear?: number;
  planningHorizonYear?: number;
  weights: DecisionWeights;
  constraints: Constraint[];
  activePrioritySignals: string[];
  selectedLocationId?: string;
  compareLocationIds: string[];
};

export type LocationFeature = {
  location_id: string;
  county_fips: string;
  county_name: string;
  state_code: string;
  state_name: string;
  nearby_metro: string;
  centroid_lat: number;
  centroid_lon: number;
  lat: number;
  lon: number;
  category_scores: CategoryScores;
  raw_metrics: Record<string, number | string | null>;
  normalized_metrics?: Record<string, number | null>;
  missing_metrics?: string[];
  category_coverage?: CategoryScores;
  category_provenance?: Partial<Record<CategoryKey, Array<Pick<EvidenceItem, "metric_name" | "source_name" | "source_year" | "raw_sha256">>>>;
  grid_readiness_score: number | null;
  power_readiness_label: string;
  capacity_pressure_score: number | null;
  data_status: "available" | "missing" | "stale" | "estimated";
  notes: string;
  data_completeness_score: number;
  last_updated: string;
  processing_version: string;
  provenance: {
    source_name: string;
    source_url: string;
    source_year: number | null;
    retrieved_at: string;
    confidence: string;
    raw_unit: string;
    transformation_method: string;
  };
};

export type EvidenceItem = {
  location_id: string;
  metric_name: string;
  raw_value: number | string | null;
  normalized_value: number | null;
  unit: string;
  source_name: string;
  source_url: string;
  source_year: number | null;
  retrieved_at: string | null;
  confidence: string;
  status: "available" | "missing" | "stale" | "estimated";
  notes: string;
  processing_version: string;
  raw_unit?: string;
  transformation_method?: string;
  normalization_method?: string;
  raw_sha256?: string | null;
  geographic_scope?: string;
  source_as_of?: string;
  source_export_date?: string;
  source_vintage_basis?: string;
  raw_artifact_name?: string;
  raw_artifact_kind?: string;
  archive_member?: string;
  archive_member_sha256?: string;
  source_column?: string;
  source_filters?: string;
  denominator_name?: string;
  denominator_value?: number | null;
};

export type FeasibilityStatus = "FEASIBLE" | "CONDITIONALLY_FEASIBLE" | "INSUFFICIENT_DATA" | "INFEASIBLE";
export type FeasibilityCheck = {
  id: string; factor: CategoryKey | "geography" | "capacity" | "priorities";
  label: string; metric: string;
  status: "PASS" | "FAIL" | "UNKNOWN" | "DILIGENCE_REQUIRED";
  value: number | string | string[] | null; threshold?: number | string;
  operator?: ConstraintOperator; required: boolean; source_refs?: string[];
};
export type FeasibilityResult = {
  is_feasible: boolean;
  status: FeasibilityStatus;
  reasons: string[];
  checks: FeasibilityCheck[];
  failed_constraints: string[];
  warnings: string[];
};

export type RankedLocation = {
  location_id: string;
  county_fips: string;
  county_name: string;
  state_code: string;
  state_name: string;
  nearby_metro: string;
  lat: number;
  lon: number;
  rank: number;
  overall_score: number;
  category_scores: CategoryScores;
  weighted_contributions: DecisionWeights;
  normalized_weights: DecisionWeights;
  strengths: string[];
  risks: string[];
  feasibility: FeasibilityResult;
  data_completeness_score: number;
  available_ranking_metrics: number;
  missing_ranking_metrics: number;
  major_missing_evidence: string[];
  confidence_label: "SCREENING_ONLY" | "LIMITED_SCREENING_DATA" | "INSUFFICIENT_DATA" | "DEMO_ESTIMATE";
  power_readiness_label: string;
  capacity_pressure_score: number | null;
  missing_metrics?: string[];
  data_status: LocationFeature["data_status"];
  notes: string;
};

export type ChangeRecord = {
  field: string;
  label: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  changeType: "profile" | "weight" | "constraint" | "geography";
};

export type ProjectIntentUpdate = {
  capacityMw?: number;
  workloadType?: WorkloadType;
  geography?: Geography;
  targetGoLiveYear?: number;
  planningHorizonYear?: number;
  priorityChanges?: Array<{
    factor: CategoryKey;
    importance?: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
    direction?: "increase" | "decrease";
  }>;
  constraintsToAdd?: Constraint[];
  constraintsToRemove?: string[];
};

export type ParseIntentResponse = {
  project: ProjectState;
  projectUpdate: ProjectIntentUpdate;
  changes: ChangeRecord[];
  missingRequiredFields: string[];
  followupQuestion: string | null;
  readyToSearch: boolean;
  assistantMessage: string;
  clarification?: string | null;
  provider?: ProviderStatus;
};

export type LLMOperation = "parse_project_intent" | "explain_location" | "explain_ranking_change";
export type LLMHealth = {
  status: "disabled" | "unverified" | "available" | "degraded";
  checked_at: string | null; last_success_at: string | null;
  operations: Partial<Record<LLMOperation, { success: boolean; checked_at: string; failure_code?: string }>>;
};
export type ProviderStatus = { provider: string; mode: "llm" | "fallback"; reason?: string; available?: boolean; health?: LLMHealth };
export type ExplanationQuestion = "why_here" | "why_not_second" | "risks" | "trade_off" | "outrank" | "ranking_change";
export type ParsedIntent = {
  update: ProjectIntentUpdate;
  action: "update_project" | "explain";
  question: ExplanationQuestion;
  audience?: Audience;
  clarification: string | null;
};
export type FactorDelta = {
  factor: CategoryKey; oldWeight: number; newWeight: number;
  oldContribution: number; newContribution: number; difference: number;
};
export type LocationDelta = {
  locationId: string; countyName: string;
  oldRank: number | null; newRank: number | null;
  oldScore: number; newScore: number;
  factors: FactorDelta[];
  newlyFailedConstraints: string[]; newlyPassedConstraints: string[];
  oldWeightedContributions: DecisionWeights; newWeightedContributions: DecisionWeights;
  contributionDeltas: DecisionWeights;
};
export type RankingChangePayload = {
  oldProject: ProjectState; newProject: ProjectState; changes: ChangeRecord[];
  locations: LocationDelta[]; newlyExcludedCount: number; newlyFeasibleCount: number;
  topN: number; enteringTopN: string[]; leavingTopN: string[];
};
export type ConversationResponse = ParseIntentResponse & {
  project_record?: { id: string; revision: number; updated_at: string };
  search?: SearchResponse;
  rankingChange?: RankingChangePayload;
  explanationPayload?: ExplanationPayload;
  audience: Audience;
  question: ExplanationQuestion;
};

export type RankingVersions = { data_release_id: string; scoring_version: string; normalization_version: string };
export type SearchResponse = RankingVersions & {
  feasibleCount: number;
  results: RankedLocation[];
  excluded: RankedLocation[];
  project: ProjectState;
  dataMode: "seeded_demo" | "public_data";
};

export type ExplanationPayload = {
  versions?: RankingVersions;
  project: ProjectState;
  location: RankedLocation;
  evidence: EvidenceItem[];
  topPositiveContributions: Array<{
    factor: CategoryKey;
    score: number;
    weight: number;
    contribution: number;
  }>;
  topNegativeContributions: Array<{
    factor: CategoryKey;
    score: number;
    weight: number;
    contribution: number;
  }>;
  nearestAlternatives: RankedLocation[];
  caveats: string[];
  question?: ExplanationQuestion;
  rankingChange?: RankingChangePayload;
  metricTypes?: Record<string, "measured" | "proxy" | "estimated" | "missing">;
  metric_quality?: MetricQuality[];
  passedConstraints?: Constraint[];
  comparison?: RankedLocation;
};

export type CompareResult = {
  locations: RankedLocation[];
  factorDeltas: Array<{
    factor: CategoryKey;
    label: string;
    values: Record<string, number | null>;
  }>;
  overallDeltas: Record<string, number>;
  summary: string;
};

export type MetricQuality = {
  metric: string; evidence_id: string; value: number | string | null; score: number | null; unit: string;
  source: string; source_url: string; source_year: number | null; source_as_of?: string;
  metric_type: "measured" | "proxy" | "estimated" | "missing";
  confidence: "OFFICIAL_SCREENING_PROXY" | "OFFICIAL_ESTIMATE" | "OFFICIAL_MEASUREMENT" | "STALE_SOURCE" | "MISSING" | "DEMO_ESTIMATE";
  status: EvidenceItem["status"]; caveat: string; raw_sha256?: string | null;
};
export type ExplanationNode = { id: string; kind: "decision" | "section" | "check" | "driver" | "metric" | "comparison" | "warning";
  label: string; description?: string; value?: number | string | null; score?: number | null;
  contribution?: number; source_refs?: string[]; children?: ExplanationNode[] };
export type TraceDriver = { factor: CategoryKey; score: number; weight: number; contribution: number;
  metric_type: MetricQuality["metric_type"]; source_refs: string[]; caveat: string };
export type DecisionTrace = RankingVersions & {
  location_id: string; rank: number | null; overall_score: number; feasibility: FeasibilityResult;
  positive_drivers: TraceDriver[]; negative_drivers: TraceDriver[];
  warnings: string[]; missing_metrics: string[]; major_missing_evidence: string[];
  data_completeness_score: number; available_ranking_metrics: number; missing_ranking_metrics: number;
  confidence_label: RankedLocation["confidence_label"];
  metrics: MetricQuality[]; evidence: Array<EvidenceItem & { evidence_id: string }>;
  alternatives: Array<{ location_id: string; rank: number; overall_score: number; score_delta: number;
    factor_deltas: Array<{ factor: CategoryKey; impact: number }>; rounding_delta: number }>;
  explanation_graph: { root: ExplanationNode }; project_hash: string;
};

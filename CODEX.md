# CODEX.md — Explainable Conversational Geospatial Decision Engine for Sustainable AI Data Center Siting

## 0. Purpose of this document

This file is the implementation brief for the coding agent.

Build a hackathon-ready MVP of an **explainable conversational geospatial decision engine** for sustainable AI data center siting.

The product should help a data center development / site-selection team answer:

> **“Given what we are trying to build, where should we build it, why, what are the trade-offs, and how does the recommendation change when our priorities change?”**

The product must not be just a dashboard and must not be just an LLM chatbot.

The core architecture is:

> **LLM interprets intent → deterministic decision engine evaluates locations → map visualizes results → LLM explains the result using actual evidence.**

The system should start with **pre-development / site selection** as the core MVP, while leaving clear extension points for:
1. Construction readiness
2. Community / approval readiness
3. Long-term operations and resilience

The challenge emphasizes balancing:
- Energy & carbon
- Heat recovery / reuse
- Water
- Climate resilience
- Grid & infrastructure
- Land & materials
- Community & economic impact
- Long-term 20–30 year viability

The product should be reusable, scalable, explainable, and evidence-backed.

---

# 1. Product vision

## One-line pitch

**An explainable AI-powered geospatial decision engine that turns natural-language infrastructure requirements into transparent, evidence-backed location recommendations, with clear reasoning for every ranking, constraint, and trade-off.**

## Longer pitch

We are building an **explainable conversational geospatial decision platform for data center developers**, starting with pre-development site selection.

A user describes the data center they want to build in natural language. The system asks follow-up questions until it has enough information, converts the conversation into a structured project profile, runs deterministic feasibility and ranking logic over a preprocessed geospatial feature store, and displays the best candidate locations on an interactive map.

The user can then continue speaking naturally:

- “Make water more important.”
- “Avoid high wildfire risk.”
- “I need 700 MW instead.”
- “Why did Michigan drop?”
- “Why is this location better than Ohio?”
- “Explain this to a local community.”
- “What could block approval?”
- “Would this still work in 2050?”

The system visibly updates filters, constraints, scores, rankings, and the map. The LLM never invents the ranking. It explains decisions from actual model outputs and source evidence.

---

# 2. Primary users

## Primary user

**Data Center Development Manager / Site Selection Lead**

Typical employer:
- Hyperscaler
- Colocation provider
- Data center developer
- Infrastructure development firm
- Infrastructure investment firm
- Utility / strategic infrastructure team

Primary job-to-be-done:

> “We need to build a new AI data center. Which locations are viable, which are best for our priorities, and why?”

## Secondary users

### Sustainability team
Needs:
- Carbon
- Water
- climate risk
- future resilience
- renewable potential
- heat reuse opportunities

### Energy / infrastructure team
Needs:
- power availability
- grid readiness
- transmission proximity
- reliability
- future interconnection / generation context

### Finance / development team
Needs:
- cost
- taxes / incentives
- market readiness
- land
- speed to build
- schedule risk

### Government / local authorities
Needs:
- why this location
- infrastructure requirements
- water / power implications
- economic development
- approvals
- mitigation

### Community stakeholders
Needs:
- water usage
- grid impact
- land use
- traffic / noise
- environmental risk
- jobs / tax base
- clear evidence, not opaque scoring

---

# 3. Product lifecycle

The product vision spans four logical layers.

## Layer 1 — Workload & capacity definition

Question:

> **What are we building?**

Core inputs:
- `capacity_mw`
- `workload_type`
  - AI training
  - AI inference
  - mixed
  - general cloud
- `geography`
- `target_go_live_year`
- top priorities
- hard constraints

Optional / advanced:
- cooling type
- rack density
- reliability target
- PUE target
- WUE target
- future expansion plan
- planning horizon

Example project profile:

```json
{
  "capacity_mw": 500,
  "workload_type": "AI_TRAINING",
  "geography": "US",
  "target_go_live_year": 2030,
  "planning_horizon_year": 2050,
  "priorities": {
    "clean_energy": 0.25,
    "water_resilience": 0.25,
    "grid_readiness": 0.20,
    "climate_resilience": 0.15,
    "fiber": 0.10,
    "cost": 0.05
  },
  "constraints": {
    "wildfire_risk_max": 60,
    "drought_risk_max": 60
  }
}
```

## Layer 2 — Pre-development / site selection

Question:

> **Where should we build?**

This is the core MVP.

Evaluate:
- Energy
- Carbon
- Grid
- Water
- Climate
- Fiber
- Land
- Infrastructure
- Cost / economics
- Market / data center ecosystem
- Workforce
- approval readiness
- community concern signals

## Layer 3 — Construction readiness

Question:

> **Can we realistically build there?**

Future / stretch:
- interconnection constraints
- transformers
- generators
- low-carbon steel
- low-carbon concrete
- construction workforce
- freight / logistics
- permitting
- embodied carbon
- material sourcing

## Layer 4 — Operations & future resilience

Question:

> **Will this location still work sustainably over 20–30 years?**

Future / stretch:
- grid decarbonization
- future water stress
- future climate
- cooling load
- extreme heat
- drought
- capacity expansion
- renewable growth
- PUE / WUE scenarios
- heat recovery potential

---

# 4. Core UX

## 4.1 Opening screen

Do not show a huge filter dashboard first.

Show a prompt-first intake experience.

Suggested structure:

```text
┌──────────────────────────────────────────────┐
│ Where should you build your next AI campus? │
│                                              │
│ Describe what you're planning:               │
│                                              │
│ [ I need a 500 MW AI training facility... ] │
│                                              │
│ Quick Start                                  │
│ Capacity      [ 500 MW ]                     │
│ Workload      [ AI Training ]                │
│ Geography     [ United States ]              │
│ Go Live       [ 2030 ]                       │
│                                              │
│                 [ Find Locations → ]         │
└──────────────────────────────────────────────┘
```

## 4.2 Adaptive intake

The LLM extracts whatever the user provided.

Required fields before first recommendation:
- capacity
- workload type
- geography
- target go-live year
- at least one priority or hard constraint

If something is missing, ask only the highest-value missing question.

Example:

User:
> “I want to build an AI data center in the US.”

System:
> “What capacity are you targeting?”

User:
> “500 MW.”

System:
> “Will this primarily support AI training, inference, or a mix?”

Continue until the minimum project profile is complete.

Do not make the LLM decide arbitrarily when it has “enough information.” Use explicit backend validation.

Pseudo-logic:

```python
if capacity_mw is None:
    ask_capacity()
elif workload_type is None:
    ask_workload()
elif geography is None:
    ask_geography()
elif target_go_live_year is None:
    ask_go_live()
elif not priorities and not constraints:
    ask_priorities()
else:
    run_engine()
```

---

# 5. Main application layout

Recommended desktop layout:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Project Profile + Dynamic Filters                                  │
│ Energy ████ Water █████ Climate ███ Grid ███ Cost ██              │
│ [2030] [500 MW] [AI Training] [Advanced Filters]                  │
├────────────────────────────────────────────┬────────────────────────┤
│                                            │ AI Decision Assistant  │
│                                            │                        │
│              INTERACTIVE MAP               │ Conversation           │
│                                            │                        │
│      ● Candidate A                         │ Interpreted priorities │
│                   ● Candidate B            │ and constraints        │
│  ● Candidate C                             │                        │
│                                            │ Suggested changes      │
│                                            │                        │
├────────────────────────────────────────────┴────────────────────────┤
│ Selected Location Details / Explanation / Evidence / Compare       │
└─────────────────────────────────────────────────────────────────────┘
```

Recommended proportions:
- Map: ~65–70%
- AI assistant: ~30–35%
- Compact top filter bar
- Bottom drawer for selected location

---

# 6. Bidirectional synchronization

This is a core differentiator.

All of these must stay synchronized:

> **CHAT ↔ PROJECT PROFILE ↔ FILTERS ↔ DECISION ENGINE ↔ MAP**

Examples:

User:
> “Water is much more important than cost.”

System:
- updates `water_weight`
- lowers `cost_weight`
- shows the change visibly
- reruns ranking
- updates map
- returns explanation of what changed

User:
> “Do not show high wildfire-risk locations.”

System:
- creates a hard constraint
- visibly shows the constraint
- removes invalid locations
- reruns ranking
- explains impact

User:
> “Increase required capacity to 700 MW.”

System:
- updates project profile
- reruns feasibility first
- some locations may become infeasible
- map updates
- explanation states why

Never silently change a decision parameter.

Always show:
- what changed
- old value
- new value
- whether it was a weight, preference, or hard constraint

---

# 7. Explainability principle

The decision engine makes the decision.

The LLM explains the decision.

Never let the LLM fabricate or directly decide the ranking.

Correct architecture:

```text
USER LANGUAGE
    ↓
LLM REQUIREMENT PARSER
    ↓
STRUCTURED PROFILE / WEIGHTS / CONSTRAINTS
    ↓
DETERMINISTIC FEASIBILITY ENGINE
    ↓
DETERMINISTIC RANKING ENGINE
    ↓
RANKED LOCATIONS + CONTRIBUTIONS + EVIDENCE
    ↓
MAP
    ↓
LLM EXPLANATION
```

The explanation prompt should receive:
- project requirements
- selected location
- raw feature values
- normalized scores
- weighted contribution by feature
- hard constraints
- rank
- nearest alternatives
- source provenance
- risk flags

The LLM should answer questions such as:
- Why this location?
- Why not another location?
- What are the biggest risks?
- What trade-off caused this ranking?
- Why did the ranking change?
- What would make another location win?
- Explain this to a developer.
- Explain this to government.
- Explain this to a local community.

---

# 8. Audience-specific explanation modes

Support at least three explanation styles.

## Developer mode
Focus on:
- grid
- economics
- site readiness
- schedule
- capacity
- risks
- alternatives

## Government mode
Focus on:
- infrastructure needs
- jobs
- tax base
- grid / water impact
- approvals
- long-term viability
- mitigation

## Community mode
Focus on:
- water
- electricity
- land
- environmental impact
- traffic / noise
- jobs
- transparency
- risks and mitigations

Same data, different explanation style.

Do not fabricate social acceptance.

---

# 9. Community & approval readiness

Add a first-class category called:

> **Community & Approval Readiness**

Do not call this only “sentiment.”

Split into two components.

## 9.1 Regulatory / approval readiness

Potential signals:
- zoning compatibility
- local data center ordinance
- permitting process
- water permits
- environmental approvals
- utility approval
- interconnection process
- known moratoria / restrictions
- planning timeline

Derived features:
- `approval_complexity_score`
- `known_restriction_flag`
- `estimated_permitting_difficulty`
- `approval_readiness_score`

## 9.2 Community / social-license signals

Potential evidence:
- local news
- planning commission minutes
- city council minutes
- public hearing documents
- public comments
- local advocacy
- past project opposition / support

Extract concern themes:
- water
- power / grid
- land use
- noise
- traffic
- environment
- jobs
- tax base
- community benefits

Do not output fake percentages such as:
- “72% of residents support this”

unless representative polling exists.

Use phrasing such as:
- “Documented concern level: high”
- “Most frequently cited concern: water”
- “Approval risk: medium”
- “Recent public discussion has focused on grid demand and land use”

---

# 10. Data strategy

Build the data layer before building the polished UI.

## 10.1 Common geographic unit

For hackathon MVP:

> **Use U.S. county FIPS as the primary comparison unit.**

Why:
- easy to join Census
- can aggregate many climate / infrastructure datasets
- scalable to thousands of locations
- easier than parcel-level siting
- can later drill down to sites

Required identity columns:

```text
location_id
county_fips
county_name
state_code
state_name
centroid_lat
centroid_lon
```

Use county as the scoring unit, but display nearby city / metro labels when useful.

---

# 11. Initial data sources

Use authoritative public data where possible.

## Energy & carbon
- EPA eGRID
  - grid carbon intensity
  - generation mix
- EIA
  - electricity data
  - reliability
  - utility / grid context
- NSRDB
  - solar potential
- wind resource datasets
  - wind potential
- Berkeley Lab / Queued Up
  - future generation / storage queue context

## Water
- WRI Aqueduct
  - current water stress
  - future water stress
- NOAA Climate Normals
  - temperature
  - cooling context
- EPA water infrastructure datasets where useful

## Climate resilience
- FEMA
  - flood / hazard data
- USDA / Wildfire Risk to Communities
  - wildfire
- NOAA / IBTrACS
  - hurricanes / storm exposure
- U.S. Drought Monitor
  - drought
- NASA NEX-GDDP-CMIP6
  - future climate projections

## Land & infrastructure
- USGS NLCD
  - land cover
  - suitability proxies
- U.S. Energy Atlas
  - energy infrastructure
- FCC Broadband Data Collection
  - fiber / broadband availability
- National Transportation Atlas
  - road / rail / logistics

## Community / economics
- Census ACS
  - population
  - labor
  - income
  - education
  - community characteristics
- BLS
  - labor market
- state / local economic data
  - incentives if available

## Existing / planned data center market
Use as market intelligence, not as sole ground truth:
- Cleanview
- Data Center Map
- Baxtel
- Cloudscene
- other legal / permitted sources

Potential derived signals:
- existing data center count
- existing MW
- planned MW
- developer count
- distance to nearest operating data center
- market maturity
- market saturation / power pressure

## News / community
Potential:
- local news feeds
- Data Center Dynamics
- GDELT
- city / county planning documents
- council minutes
- public hearing records

---

# 12. Data-source priority for MVP

Do not integrate everything at once.

Start with 6–8 strong signals.

Priority order:

1. EPA eGRID — grid carbon
2. EIA — grid / energy context
3. WRI Aqueduct — water stress
4. FEMA / wildfire — climate hazards
5. NOAA — temperature / cooling climate
6. FCC — fiber
7. USGS — land
8. Census — workforce / community
9. Data center market data — ecosystem / planned capacity

Stretch:
- LBNL interconnection queue
- local approvals
- community news
- construction materials
- future NASA climate scenarios

---


# 12A. Dataset acquisition policy — IMPORTANT

Codex should **attempt to automate public dataset acquisition**, but dataset downloading must never be allowed to break the rest of the project.

Follow these rules exactly.

## 12A.1 General behavior

For each external dataset:

1. Prefer the **official public source**.
2. Prefer, in order:
   - documented API
   - direct CSV / JSON / Parquet download
   - official ZIP / GeoPackage / shapefile download
   - official bulk-download page
3. Do not scrape a website when a documented API or downloadable file exists.
4. Do not bypass:
   - authentication
   - paywalls
   - CAPTCHA
   - terms-of-service restrictions
   - access controls
5. Do not fabricate a download URL.
6. Do not assume a file downloaded successfully just because an HTTP request returned.
7. Never block the entire application because one dataset is unavailable.

## 12A.2 Network-access behavior

If the coding environment has network access:

- attempt to download public datasets programmatically
- use bounded timeouts
- use limited retries with backoff
- validate response type and file size
- log the source URL and retrieval timestamp
- save the raw artifact before transforming it

If the environment does **not** have network access, or a source cannot be downloaded reliably:

- do not keep retrying indefinitely
- do not stop the build
- create a clear manual-ingestion instruction file
- continue using cached, seeded, or already-available data

## 12A.3 Manual-download fallback

For every dataset that cannot be fetched automatically, create:

```text
data/raw/<source_name>/README.md
```

That README must state:

- dataset name
- official source page
- exact file(s) expected
- expected format
- where the user should place the file
- whether any account / agreement is required
- preprocessing command to run afterward

Example:

```text
data/raw/wri_aqueduct/README.md
```

with instructions such as:

```text
Download the official Aqueduct dataset from WRI.
Place the downloaded GeoPackage/CSV in:

data/raw/wri_aqueduct/

Then run:

python pipelines/ingest/wri_aqueduct.py
```

The rest of the application must continue to work without this dataset.

## 12A.4 Raw-data immutability

Never modify downloaded raw source files in place.

Use:

```text
data/raw/
data/interim/
data/processed/
data/feature_store/
```

Meaning:

```text
raw         = original source exactly as received
interim     = cleaned / extracted source-level data
processed   = county-level standardized features
feature_store = final model-ready tables
```

If a download already exists, do not overwrite it automatically unless:
- the user explicitly requests refresh, or
- the pipeline has a safe versioning strategy.

Prefer filenames containing source year or retrieval date where useful.

## 12A.5 Idempotent ingestion

Every ingestion script must be safe to run multiple times.

It should:

- detect existing raw files
- skip unnecessary downloads
- avoid duplicate rows
- produce deterministic outputs
- write temporary files before replacing final processed outputs
- fail with a clear source-specific error rather than corrupting shared data

Do not leave partially downloaded files with final filenames.

Use a temporary suffix such as:

```text
file.zip.part
```

and rename only after validation succeeds.

## 12A.6 Validation before accepting a dataset

Each ingestion pipeline should validate the source before it becomes part of the feature store.

At minimum check:

- file exists
- file is non-empty
- expected columns exist
- geographic identifier or geometry exists
- numeric columns parse correctly
- row count is plausible
- latitude / longitude values are valid if present
- county FIPS values are valid after mapping
- normalized scores remain within `[0, 100]`

If schema validation fails:
- do not push broken values into the feature store
- report the problem
- continue with the last known good processed version or mark the feature unavailable

## 12A.7 Missing-data behavior

A missing dataset must not crash ranking.

For every feature define:

```text
status = available | missing | stale | estimated
```

If a feature is unavailable:
- do not silently set it to zero
- do not pretend zero means “bad”
- exclude it from the applicable score or use an explicitly documented fallback
- renormalize active weights if needed
- lower `data_completeness_score`
- expose the missing evidence in the UI

Example:

> “Local approval data is unavailable for this county, so approval readiness is excluded from this ranking.”

## 12A.8 Last-known-good behavior

Processed datasets should use a last-known-good strategy.

If a refresh fails:
- keep the previous valid processed file
- log the refresh error
- do not delete the previous working dataset
- do not rebuild the feature store from a corrupt source

## 12A.9 Source registry

Create a central source registry, for example:

```text
config/data_sources.yaml
```

Suggested structure:

```yaml
sources:
  egrid:
    name: "EPA eGRID"
    domain: "epa.gov"
    category: "energy"
    required_for_mvp: true
    acquisition: "download"
    raw_dir: "data/raw/egrid"
    refresh: "annual"

  wri_aqueduct:
    name: "WRI Aqueduct"
    domain: "wri.org"
    category: "water"
    required_for_mvp: true
    acquisition: "manual_or_download"
    raw_dir: "data/raw/wri_aqueduct"
```

Do not scatter source URLs throughout the codebase.

## 12A.10 Provenance requirements

Every processed metric must preserve:

```text
source_name
source_url
source_year
retrieved_at
processing_version
raw_unit
transformation_method
```

If a metric combines multiple sources, preserve all contributing sources.

## 12A.11 Caching

Do not redownload large datasets on every application startup.

Dataset acquisition must be an explicit pipeline step, for example:

```bash
make data
```

or:

```bash
python pipelines/build_feature_store.py
```

The web application should read preprocessed local data.

It should **not** download FEMA, FCC, EPA, WRI, etc. while a user is interacting with the map.

## 12A.12 Safe hackathon fallback

If a critical source is unavailable during development:

1. use the last valid cached version if available
2. otherwise use a small seeded demo dataset
3. label seeded / synthetic values in development metadata
4. keep the interface and engine working
5. replace seeded values with real data as soon as ingestion succeeds

Never hardcode a fake location ranking as if it came from real data.

## 12A.13 Dataset-specific practical guidance

### EPA eGRID
Attempt automatic official download.
If format changes, fail only the eGRID ingestion step and preserve last-known-good output.

### EIA
Use documented APIs or official downloadable files.
Keep API keys in environment variables if required.

### Census ACS
Use the official Census API where practical.
Cache responses / derived county features locally.

### WRI Aqueduct
Attempt official download if a stable direct source exists.
If the download flow requires manual interaction, create manual instructions and continue.

### FEMA
Prefer official downloadable hazard datasets or APIs.
Do not fetch nationwide heavy GIS layers at application runtime.

### NOAA
Use documented APIs / bulk data where practical.
Cache derived climate features.

### FCC
Prefer official bulk-download datasets.
Because files may be large, allow manual download fallback and process locally.

### USGS
Use official downloadable land-cover products.
Precompute county-level land features.

### Cleanview / commercial data-center sources
Never bypass paid access.
Use only:
- public samples
- explicitly permitted API access
- files supplied by the user
- publicly licensed exports

### News / local government sources
Do not create an uncontrolled scraper as part of the core MVP.
Prefer:
- official RSS / API
- public meeting documents
- explicitly permitted retrieval
- manually curated links for the first demo

## 12A.14 Required CLI behavior

Create source-specific commands so a failure is isolated.

Examples:

```bash
python pipelines/ingest/egrid.py
python pipelines/ingest/census.py
python pipelines/ingest/wri.py
python pipelines/ingest/fema.py
python pipelines/build_feature_store.py
```

Also provide a top-level command:

```bash
make data
```

`make data` should:
- run available ingestion jobs
- skip unavailable optional sources with warnings
- fail only if the minimum required MVP feature store cannot be produced
- print a clear summary at the end

Example summary:

```text
EPA eGRID        OK
Census ACS       OK
WRI Aqueduct     MANUAL DOWNLOAD REQUIRED
FEMA             OK
FCC              USING CACHED VERSION

Feature store built successfully.
Data completeness: 82%
```

## 12A.15 Never do these things

Do not:
- invent data
- invent source URLs
- treat failed downloads as valid files
- overwrite good cached data with a failed refresh
- normalize missing values as zero
- depend on live third-party downloads during the demo
- bypass restricted access
- scrape commercial sites without permission
- let one unavailable dataset crash the product
- mix synthetic data with real data without labeling it


# 13. Data preprocessing pipeline

All raw data must be converted into a common county-level feature store.

Pipeline:

```text
RAW DATA
    ↓
CLEAN
    ↓
STANDARDIZE UNITS
    ↓
GEOSPATIAL JOIN
    ↓
ASSIGN COUNTY FIPS
    ↓
AGGREGATE BY COUNTY
    ↓
DERIVE FEATURES
    ↓
NORMALIZE
    ↓
STORE RAW + NORMALIZED + PROVENANCE
```

Examples:

### Flood
```text
FEMA flood polygons
→ spatial join to county
→ percent county exposed
→ flood_risk_raw
→ flood_risk_score
```

### Fiber
```text
FCC availability
→ county aggregation
→ fiber_coverage_pct
→ fiber_score
```

### Water
```text
WRI water stress
→ spatial join / county aggregation
→ water_stress_raw
→ water_resilience_score
```

### Existing data centers
```text
facility points
→ county join
→ operating_count
→ operating_mw
→ planned_count
→ planned_mw
→ market_readiness_score
→ capacity_pressure_score
```

---

# 14. Keep raw values and normalized scores

Never overwrite raw data with only a 0–100 score.

Store both.

Example:

```json
{
  "metric": "grid_carbon_intensity",
  "raw_value": 412,
  "raw_unit": "kgCO2e/MWh",
  "normalized_score": 68,
  "source": "EPA eGRID",
  "source_year": 2025
}
```

This is essential for:
- explainability
- auditability
- debugging
- evidence display
- stakeholder trust

---

# 15. Feature store

Create a master `location_features` dataset.

Possible schema:

```text
location_id
county_fips
county_name
state_code
lat
lon

# Energy
grid_carbon_intensity_raw
grid_carbon_score
renewable_potential_score
grid_reliability_score
future_power_score
electricity_cost_score

# Water
water_stress_current_raw
water_stress_2030_raw
water_stress_2050_raw
water_resilience_score
cooling_climate_score

# Climate
flood_risk_score
wildfire_risk_score
drought_risk_score
hurricane_risk_score
extreme_heat_score
climate_resilience_score

# Infrastructure
fiber_score
transmission_access_score
transportation_score
land_suitability_score
infrastructure_score

# Market
existing_dc_count
existing_dc_mw
planned_dc_count
planned_dc_mw
dc_ecosystem_score
capacity_pressure_score

# Economic / community
workforce_score
economic_opportunity_score
community_exposure_score

# Approval / community
approval_readiness_score
community_concern_score

# Construction (optional)
construction_readiness_score

# Metadata
data_completeness_score
last_updated
```

Use Parquet + DuckDB for speed in MVP, or Postgres/PostGIS if already available.

Recommendation for hackathon:
- preprocessing: Python + Pandas/GeoPandas
- storage: Parquet + DuckDB
- optional production path: Postgres/PostGIS

---

# 16. Evidence store

Create a separate `evidence_store`.

Schema:

```text
location_id
metric_name
raw_value
normalized_value
unit
source_name
source_url
source_year
retrieved_at
confidence
notes
```

This drives explanations.

The explainability layer should be able to say:

> “Water resilience is strong because the underlying water-stress metric is X, sourced from WRI Aqueduct.”

Do not claim evidence that is not present.

---

# 17. Normalization

Different datasets use incompatible units.

Examples:
- kg CO2e / MWh
- water-stress index
- percent fiber coverage
- miles / km
- flood probability
- $ / MWh
- acres
- count / MW

Create deterministic transformations into 0–100 scores.

Rules:
- preserve raw value
- document directionality
- document min / max or percentile transformation
- avoid hiding extreme values
- use robust percentile normalization where appropriate
- invert risk metrics so that high score always means “better”

Example:

```python
water_resilience_score = 100 - normalized_water_stress
```

For missing data:
- never silently set to 0
- track `missing`
- optionally impute only if explicitly documented
- reduce `data_completeness_score`
- expose uncertainty in explanations

---

# 18. Feasibility engine

Ranking comes after feasibility.

Do not rank impossible locations.

Inputs:
- project profile
- location feature store

Potential hard constraints:
- geography
- minimum grid / power readiness
- land availability
- fiber availability
- maximum climate risk
- maximum water stress
- approval restrictions
- target timeline
- capacity requirement

MVP example:

```python
def is_feasible(project, location):
    if location.state_code not in project.allowed_states:
        return False

    if location.grid_reliability_score < project.min_grid_score:
        return False

    if location.water_resilience_score < project.min_water_score:
        return False

    if location.wildfire_risk_score < project.min_wildfire_resilience:
        return False

    return True
```

For power capacity, be careful:
public datasets may not support a precise statement such as “this county has 700 MW available now.”

Use labels such as:
- strong power readiness
- moderate power readiness
- uncertain
- requires utility validation

Avoid false precision.

---

# 19. Decision / ranking engine

Start with a transparent weighted scoring model.

Example categories:

```text
Power & Grid             30%
Water + Climate          20%
Infrastructure / Land    15%
Approval Readiness       15%
Community Readiness      10%
Economics                10%
```

These defaults are only starting points.

User preferences must dynamically change weights.

Recommended implementation:

```python
score = (
    weights.energy * features.energy_score +
    weights.water * features.water_score +
    weights.climate * features.climate_score +
    weights.infrastructure * features.infrastructure_score +
    weights.economic * features.economic_score +
    weights.approval * features.approval_score +
    weights.community * features.community_score
)
```

Return:
- overall score
- rank
- per-category score
- per-category weighted contribution
- failed / passed constraints
- confidence / completeness

Also store a `ranking_explanation_payload`.

---

# 20. Multi-objective / sensitivity layer

Stretch goal after MVP works.

Add:
- Pareto frontier
- sensitivity analysis
- scenario analysis

Questions to support:
- “Which locations remain strong across many weighting schemes?”
- “What locations trade cost for water resilience?”
- “How sensitive is the top recommendation to a small change in weights?”
- “What would have to change for location B to outrank location A?”

Useful outputs:
- rank stability
- top drivers
- tipping point
- Pareto-optimal candidates

This will make the decision engine feel more sophisticated than a static weighted dashboard.

---

# 21. LLM requirements parser

Create a strict structured schema.

Example TypeScript / JSON schema concept:

```ts
type ProjectIntentUpdate = {
  capacity_mw?: number;
  workload_type?: "AI_TRAINING" | "AI_INFERENCE" | "MIXED" | "CLOUD";
  geography?: {
    country?: string;
    states?: string[];
    regions?: string[];
  };
  target_go_live_year?: number;
  planning_horizon_year?: number;

  priority_changes?: Array<{
    factor: string;
    importance: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  }>;

  constraints_to_add?: Array<{
    factor: string;
    operator: "<" | "<=" | ">" | ">=" | "=";
    value: number | string;
  }>;

  constraints_to_remove?: string[];

  needs_followup: boolean;
  followup_question?: string;
};
```

The LLM output must be validated against schema.

Never directly execute arbitrary LLM-generated code.

---

# 22. Follow-up question logic

The backend owns required-field logic.

The LLM can word the follow-up naturally, but backend decides which field is missing.

Priority:
1. capacity
2. workload
3. geography
4. target year
5. priorities / constraints

Avoid interrogating the user with 15 questions.

Ask only what is necessary to produce a credible first result.

After results appear, optional refinement can continue.

---

# 23. Natural-language updates

Support utterances like:

- “Water matters more.”
- “Cost is secondary.”
- “Avoid wildfire risk.”
- “Focus on Midwest.”
- “I need 700 MW.”
- “We need to be live by 2029.”
- “Show only lower-carbon grids.”
- “What if the facility expands by 50%?”
- “Prioritize faster permitting.”

Each should produce a structured delta.

Example:

```json
{
  "priority_changes": [
    {
      "factor": "water_resilience",
      "importance": "VERY_HIGH"
    }
  ]
}
```

Then:
- update state
- rerun feasibility if relevant
- rerun ranking
- update map
- explain delta

---

# 24. Map behavior

Use an interactive map.

Suggested stack:
- MapLibre GL JS or Mapbox GL
- optional deck.gl for richer layers

Each candidate needs:
- lat
- lon
- rank
- score
- feasibility state
- selected state
- top strengths
- top risks

Visual behavior:
- strongest candidates prominent
- weaker candidates smaller / faded
- infeasible candidates hidden or clearly excluded
- map can zoom to recommendation cluster
- hover shows summary
- click opens detail panel

Do not rely on color alone; support labels / sizing / accessible cues.

---

# 25. Selected-location detail panel

When a location is clicked, show:

```text
Location Name

Overall Fit: 87/100
Rank: #2

Clean Energy          92
Water Resilience      84
Grid Readiness        89
Climate Resilience    86
Fiber                 91
Cost                  73

Top strengths
Top risks
Failed / near-failed constraints
Data completeness

[Why this location?]
[Compare]
[Community Impact]
[Approval Readiness]
[Future Outlook]
[Evidence]
```

---

# 26. Explainability payload

Build explanations from structured facts.

Example:

```json
{
  "location": "Example County, MI",
  "rank": 1,
  "overall_score": 87.2,
  "project": {
    "capacity_mw": 500,
    "workload_type": "AI_TRAINING",
    "target_go_live_year": 2030
  },
  "top_positive_contributions": [
    {
      "factor": "water_resilience",
      "score": 89,
      "weight": 0.25,
      "contribution": 22.25
    },
    {
      "factor": "clean_energy",
      "score": 91,
      "weight": 0.25,
      "contribution": 22.75
    }
  ],
  "top_negative_contributions": [
    {
      "factor": "cost",
      "score": 61,
      "weight": 0.05,
      "contribution": 3.05
    }
  ],
  "risks": [
    "Moderate approval complexity"
  ],
  "sources": [
    {
      "metric": "water_stress",
      "source": "WRI Aqueduct"
    }
  ]
}
```

Then send this to the LLM.

---

# 27. Explain ranking changes

This is an important demo feature.

When a user changes a parameter, compare before / after.

Compute:
- old rank
- new rank
- old total score
- new total score
- changed factor
- contribution delta
- newly failed / passed constraints

Example output:

> “This location dropped from #2 to #5 because water weight increased from 20% to 40%. Its water score is weaker than the other top candidates, so the increase in water importance reduced its relative fit despite strong grid and fiber scores.”

This should be computed from real deltas, not guessed.

---

# 28. Comparison mode

Support comparison of 2–4 candidates.

Table:

```text
                    A       B       C
Clean Energy        92      81      96
Water               84      79      76
Climate             86      81      82
Grid                89      90      82
Fiber               91      88      75
Cost                73      87      85
Approval             68      76      70
Overall              87      84      83
```

LLM can explain:
- why A outranks B under current priorities
- what would make B outrank A
- major trade-offs

---

# 29. Scenario mode

Stretch goal.

At minimum support:
- current
- 2030
- 2050

Potential changing features:
- water stress
- extreme heat
- grid carbon
- renewable potential / pipeline
- climate risk
- cooling requirement

Scenario question:

> “Does this site still remain attractive in 2050?”

Use available future data only.

Do not invent future projections for metrics without a source.

---

# 30. Technology stack

Recommended hackathon stack.

## Frontend
- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui or lightweight component system
- MapLibre GL JS or Mapbox GL
- Recharts for small charts if needed

## Backend
- Python
- FastAPI
- Pydantic
- Pandas
- GeoPandas
- DuckDB
- PyArrow
- Shapely

## Data
MVP:
- Parquet
- GeoJSON only where needed for frontend

Optional:
- PostgreSQL + PostGIS

## LLM
Use a provider abstraction.

Required capabilities:
1. structured extraction to schema
2. evidence-grounded explanation

Do not couple business logic to a specific LLM.

Example:

```python
class LLMProvider:
    def parse_project_intent(self, messages, current_project): ...
    def explain_location(self, explanation_payload, audience): ...
```

---

# 31. API design

Suggested endpoints.

## Project / conversation

`POST /api/project/parse-intent`

Input:
```json
{
  "message": "I need a 500 MW AI training site...",
  "current_project": {}
}
```

Output:
```json
{
  "project_update": {},
  "missing_required_fields": [],
  "followup_question": null
}
```

## Search / ranking

`POST /api/locations/search`

Input:
```json
{
  "project": {}
}
```

Output:
```json
{
  "feasible_count": 175,
  "results": []
}
```

## Location detail

`GET /api/locations/{location_id}`

## Explain

`POST /api/locations/{location_id}/explain`

Input:
```json
{
  "project": {},
  "audience": "developer"
}
```

## Compare

`POST /api/locations/compare`

## Scenario

`POST /api/scenarios/evaluate`

Stretch.

---

# 32. Ranking result schema

```ts
type RankedLocation = {
  location_id: string;
  county_name: string;
  state_code: string;
  lat: number;
  lon: number;

  rank: number;
  overall_score: number;

  category_scores: {
    energy: number;
    water: number;
    climate: number;
    infrastructure: number;
    economics: number;
    approval: number;
    community: number;
  };

  weighted_contributions: Record<string, number>;

  strengths: string[];
  risks: string[];

  feasibility: {
    is_feasible: boolean;
    failed_constraints: string[];
    warnings: string[];
  };

  data_completeness_score: number;
};
```

---

# 33. Frontend state model

Keep a single canonical project state.

```ts
type ProjectState = {
  capacityMw?: number;
  workloadType?: string;
  geography?: Geography;
  targetGoLiveYear?: number;
  planningHorizonYear?: number;

  weights: DecisionWeights;
  constraints: Constraint[];

  selectedLocationId?: string;
  compareLocationIds: string[];
};
```

Chat edits this state.

Filters edit this state.

Ranking reads this state.

No duplicated independent state.

---

# 34. Repository structure

Suggested:

```text
/
├── CODEX.md
├── README.md
├── apps/
│   └── web/
│       ├── app/
│       ├── components/
│       │   ├── map/
│       │   ├── chat/
│       │   ├── filters/
│       │   ├── location/
│       │   └── compare/
│       └── lib/
│
├── services/
│   └── api/
│       ├── main.py
│       ├── routes/
│       ├── models/
│       ├── decision_engine/
│       │   ├── feasibility.py
│       │   ├── scoring.py
│       │   ├── sensitivity.py
│       │   └── explanations.py
│       ├── llm/
│       │   ├── provider.py
│       │   ├── intent_parser.py
│       │   └── explainer.py
│       └── data/
│
├── pipelines/
│   ├── ingest/
│   ├── transform/
│   ├── features/
│   └── build_feature_store.py
│
├── data/
│   ├── raw/
│   ├── processed/
│   └── feature_store/
│
├── scripts/
└── tests/
```

If speed is more important, a simpler single Next.js app + Python preprocessing scripts is acceptable.

---

# 35. Build order

Do not start by polishing UI.

Build in this order.

## Phase 1 — Data foundation
1. Define county FIPS master table.
2. Ingest 3–5 datasets first.
3. Normalize and join.
4. Produce `location_features.parquet`.
5. Produce `evidence.parquet`.
6. Validate a handful of counties manually.

Initial minimum:
- eGRID
- WRI
- FEMA / wildfire
- FCC
- Census

Add EIA / NOAA / USGS next.

## Phase 2 — Deterministic engine
1. Implement project schema.
2. Implement hard feasibility rules.
3. Implement weighted scoring.
4. Return top 20 candidates.
5. Return per-factor contributions.
6. Unit test ranking.

## Phase 3 — Basic map
1. Load ranked locations.
2. Show points.
3. Click a point.
4. Show metrics and score.
5. Add top filters.

## Phase 4 — Conversational intake
1. Add chat.
2. Parse natural language to schema.
3. Ask missing questions.
4. Auto-update project profile.
5. Rerun engine.

## Phase 5 — Dynamic synchronization
1. Chat changes filters.
2. Filters change ranking.
3. Ranking changes map.
4. Show visible “what changed.”

## Phase 6 — Explainability
1. Build explanation payload.
2. LLM generates evidence-grounded response.
3. Show source / evidence drawer.
4. Add “Why here?”
5. Add “Why did ranking change?”

## Phase 7 — Comparison
1. Compare 2–4 sites.
2. Show score table.
3. Explain trade-offs.

## Phase 8 — Community / approval
1. Add a small number of trustworthy signals.
2. Extract concern themes.
3. Show “approval readiness” and “documented concerns.”
4. Avoid fake sentiment precision.

## Phase 9 — Future scenarios / construction
Only if time remains.

---

# 36. Hackathon MVP definition

The MVP is complete if this exact flow works:

```text
User:
"I need a 500 MW AI training facility in the US
by 2030 with low water risk and strong clean energy."

↓
LLM parses project requirements

↓
Backend validates required fields

↓
Decision engine removes infeasible candidates

↓
Decision engine ranks feasible locations

↓
Map displays top candidates

↓
User clicks a location

↓
User asks:
"Why here?"

↓
System explains using actual metrics and sources

↓
User says:
"Water is even more important."

↓
System visibly changes water weight

↓
Ranking changes

↓
Map changes

↓
System explains exactly why the ranking changed
```

If this works smoothly, the core product is successful.

---

# 37. Stretch demo flow

If implemented:

1. Start with 500 MW AI training project.
2. Show top candidates.
3. Click top candidate.
4. Explain.
5. Increase water importance.
6. Ranking changes.
7. Ask “Why did it change?”
8. Compare top two.
9. Switch audience to “Community.”
10. Explain local water / grid / land concerns.
11. Switch scenario to 2050.
12. Show rank stability / future risk.

---

# 38. Product principles

## 38.1 Explainable by design
Every recommendation must have:
- inputs
- weights
- constraints
- raw data
- score contribution
- source provenance

## 38.2 Deterministic core
Same project profile + same data = same ranking.

LLM wording may vary, ranking must not.

## 38.3 No hidden AI decisions
All LLM-interpreted changes must be visible.

## 38.4 No false precision
Especially:
- grid capacity
- approval timing
- social acceptance
- future projections

Show uncertainty.

## 38.5 Evidence over persuasion
The product should help users explain decisions to communities and governments.

Do not optimize for “convincing” people regardless of evidence.

Instead:
- show benefits
- show risks
- show concerns
- show mitigation
- show sources

## 38.6 Build reusable primitives
The same feature store and engine should support:
- site selection
- comparison
- scenario analysis
- construction readiness
- long-term operations

---

# 39. Data confidence

Add a data-quality indicator per location.

Example:

```text
Data confidence: 87%

Missing:
- local permitting timeline
- parcel-level land availability
```

Potential logic:

```python
required_metrics = [...]
available = count_non_null(required_metrics)
data_completeness_score = 100 * available / len(required_metrics)
```

The LLM should state uncertainty where important.

---

# 40. Do not overclaim grid capacity

A major technical caveat:

Public grid data may indicate:
- generation
- reliability
- transmission
- utility
- queued generation
- market conditions

It often does NOT prove:
- “500 MW is definitely available at this exact site.”

For MVP:
- call this `grid_readiness`
- call capacity claims `estimated` or `proxy`
- flag that detailed utility / interconnection studies are required

This improves credibility.

---

# 41. Market readiness vs market pressure

Existing data centers nearby can mean both good and bad things.

Create two separate features.

## Data center ecosystem readiness
Positive:
- existing data centers
- developer presence
- fiber ecosystem
- workforce
- proven permitting history

## Capacity pressure
Negative / caution:
- large planned MW
- high data center concentration
- grid competition
- land pressure
- potential water / community pressure

Do not automatically treat more data centers as better.

---

# 42. Community outputs

For shortlisted locations, create:

```text
Community Impact Snapshot

Potential concerns
- water
- power / grid
- land
- traffic
- noise
- environment

Potential benefits
- construction employment
- permanent jobs
- tax base
- infrastructure investment

Approval signals
- zoning
- permitting complexity
- known restrictions
- recent public discussion

Evidence
- planning documents
- census
- news
- utility / grid data
```

---

# 43. Decision engine output should support “why not?”

For any candidate A and B, calculate:

```text
score_A - score_B
```

and factor-level deltas.

Example:

```text
A beats B by +4.2 points

+6.0 water
+3.0 climate
+1.5 clean energy
-3.1 cost
-2.2 approval
-1.0 infrastructure
```

Then the LLM can explain the exact trade-off.

---

# 44. Future architecture

The same system can later become:

```text
WORKLOAD DEFINITION
        ↓
PRE-DEVELOPMENT
Where should we build?
        ↓
SELECTED SITE
        ↓
CONSTRUCTION
How should we build?
        ↓
OPERATIONS
How should we run sustainably?
        ↓
EXPANSION / REASSESSMENT
Does the site remain viable?
```

Do not build all of this deeply during the MVP.

---

# 45. Testing requirements

## Data tests
- county FIPS uniqueness
- valid lat / lon
- normalization in [0, 100]
- no impossible percentages
- source metadata exists
- directionality correct

## Engine tests
- increasing a positive weight should not lower its direct contribution
- hard constraints remove candidates
- same input produces same output
- weight totals normalize correctly
- missing values handled deterministically

## LLM parser tests
Test:
- incomplete prompts
- contradictory priorities
- hard constraints
- weight changes
- capacity changes
- geography changes

## Explainability tests
- explanation contains only supplied evidence
- no unsupported precise capacity claims
- no fake community-support percentages
- sources included where relevant

---

# 46. Development conventions

- Type all public interfaces.
- Keep scoring functions pure.
- Put decision rules in code, not prompts.
- Put LLM prompts in separate files.
- Use environment variables for API keys.
- Never commit secrets.
- Prefer simple, testable functions.
- Avoid overengineering.
- Favor working end-to-end demo over perfect infrastructure.
- Add comments only where logic is non-obvious.
- Keep generated data out of Git when large.
- Include a reproducible `make data` or equivalent pipeline command.
- Include a seeded demo dataset if full public-data ingestion is too slow.

---

# 47. Suggested environment variables

```bash
LLM_PROVIDER=
LLM_API_KEY=
MAP_TOKEN=
DATABASE_URL=
DATA_DIR=
```

MapLibre can avoid a paid token depending on tile source.

---

# 48. Local demo fallback

If external APIs or datasets are unreliable during demo:

- precompute feature store
- precompute top candidates
- cache geospatial data
- cache evidence
- do not depend on live external datasets for every user interaction

Only the LLM may be live.

The ranking engine should run locally / server-side on cached preprocessed data.

---

# 49. Initial seeded factors if full data is not ready

For early UI integration, seed a small realistic demo dataset for ~10–20 counties.

Fields:
- energy
- water
- climate
- grid
- fiber
- land
- cost
- approval
- community
- lat / lon

Clearly label seeded values in development.

Replace them progressively with real datasets.

---

# 50. Suggested first candidate regions for testing

Use a geographically diverse test set so trade-offs are visible.

Examples:
- Michigan
- Ohio
- Iowa
- Virginia
- Texas
- Arizona
- Oregon
- Georgia
- North Carolina
- Utah

Do not hardcode these as “best.”

Use only as demo / validation candidates until the engine ranks the full dataset.

---

# 51. UI details

## Top bar
Show:
- capacity
- workload
- target year
- active weights
- hard constraints
- scenario year

## Map
Show:
- top candidates
- rank
- score
- hover tooltip
- click selection

## Chat
Show:
- conversation
- interpreted update
- missing fields
- “applied changes”

## Detail drawer
Show:
- score
- category metrics
- weighted contributions
- risks
- evidence
- compare action
- explain action

---

# 52. Important naming

Prefer:
- Decision Engine
- AI Decision Assistant
- Project Profile
- Feasibility Gate
- Site Fit
- Grid Readiness
- Water Resilience
- Climate Resilience
- Approval Readiness
- Community Concern Signals
- Market Readiness
- Capacity Pressure
- Evidence
- Explainability

Avoid:
- AI magically chooses
- guaranteed power capacity
- sentiment score without evidence
- community approval percentage without polling
- “best location” without explaining assumptions

---

# 53. What not to build first

Do not start with:
- complex 3D map
- parcel-level siting
- every U.S. permit
- every construction supplier
- live scraping
- full forecasting model
- elaborate agent framework
- multi-agent orchestration
- fine-tuned model

First get:

> **Prompt → structured requirements → feasibility → ranking → map → explanation → live re-ranking**

working.

---

# 54. Success criteria

The product is successful if a mentor / judge can see:

1. The user describes a project naturally.
2. The system asks smart follow-up questions.
3. The AI visibly converts language into structured priorities.
4. The engine filters infeasible locations.
5. Ranked locations appear on a map.
6. The user can inspect the evidence.
7. The user can ask “Why?”
8. The answer references real decision factors.
9. The user changes a priority in natural language.
10. Rankings and map update instantly.
11. The system explains why the outcome changed.
12. The architecture can clearly extend to construction and future operations.

---

# 55. First tasks for Codex

Start implementation in this order.

## Task 1
Inspect the existing repository.

Output:
- current stack
- files
- what is reusable
- what is missing

Do not rewrite an existing working app unnecessarily.

## Task 2
Create canonical project / location schemas.

## Task 3
Create a small seeded feature store if no real data exists yet.

## Task 4
Implement deterministic feasibility + scoring engine with tests.

## Task 5
Create ranking API.

## Task 6
Build map + location detail UI.

## Task 7
Build conversational intake with structured extraction.

## Task 8
Synchronize chat → project state → engine → map.

## Task 9
Build explanation payload and LLM explainer.

## Task 10
Add evidence drawer and compare mode.

Then replace seeded datasets with real preprocessed public data.

---

# 56. Coding-agent behavior

When working on this repository:

- Do not ask broad product questions already answered in this file.
- Make reasonable implementation decisions consistent with the MVP.
- Prefer the simplest architecture that supports the full demo loop.
- Do not add unnecessary dependencies.
- Keep the core scoring deterministic.
- Keep LLM usage isolated behind an adapter.
- Keep data-source logic isolated from scoring.
- Keep scoring explainable.
- Preserve provenance.
- Make the UI demoable even before all real data is integrated.
- Do not block UI development on perfect datasets.
- Do not hardcode rankings.
- Do not allow the LLM to make untraceable scoring decisions.
- Always expose assumptions.
- If a dataset does not support a precise claim, represent uncertainty.

---

# 57. Final mental model

Think of the system as five engines working together:

```text
1. REQUIREMENT ENGINE
   What is the developer trying to build?

2. DATA ENGINE
   What do we know about each location?

3. FEASIBILITY ENGINE
   Where could this project plausibly work?

4. DECISION ENGINE
   Which feasible locations best match the user's priorities?

5. EXPLAINABILITY ENGINE
   Why did the decision engine produce this result?
```

The map is the visualization.

The chat is the control layer.

The LLM is the interpreter and explainer.

The deterministic data + decision engine is the source of truth.

---

# 58. Demo sentence

The entire demo should be understandable from this sentence:

> **“Tell us what data center you want to build, and our system will identify where it can realistically go, rank the locations according to your priorities, show the trade-offs on a live map, and explain every recommendation using the underlying evidence.”**



# 59. Dataset acquisition execution rule

When starting the project, Codex must first inspect whether network access is available.

Then:

```text
IF official public dataset is directly accessible:
    download → validate → cache raw → preprocess
ELSE IF the dataset already exists locally:
    preprocess local file
ELSE:
    create manual-download README
    mark source unavailable
    continue building
```

Codex must never pause the entire implementation waiting for a single dataset.

The first goal is always to produce a working end-to-end system with a valid feature store, even if some optional features are temporarily unavailable.

Before integrating any newly downloaded source into ranking:
1. validate schema
2. validate geography
3. validate units
4. validate directionality
5. retain provenance
6. run tests
7. only then rebuild the feature store

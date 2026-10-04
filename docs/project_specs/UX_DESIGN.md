# UX_REDESIGN.md

## Goal

Redesign the product so it feels like an AI decision product first and a data dashboard second.

The frontend should be optimized for desktop web only.

Target viewport:
- 1440 × 900
- standard laptop / desktop browser

Do not optimize for mobile in this phase.

---

# 1. Core product flow

The product has three stages:

1. Conversation
2. Decision workspace
3. Explanation

The user experience should feel continuous.

Do not make these feel like separate unrelated pages.

---

# 2. Stage 1 — Chat-first landing page

The landing page should show:

- product name / logo
- one main conversational prompt
- minimal quick-start fields
- no map yet
- no large filter dashboard
- no explanation tree
- no comparison table
- no audit/history panel

Primary question:

> Where should you build your next AI data center?

Main chat input:

> Tell me what you're planning to build...

Example placeholder:

> I need a 500 MW AI training campus by 2030 with strong clean energy and low water risk.

---

# 3. Geography rules

Country is fixed permanently to:

> United States

The LLM must never ask the user which country they want.

The default search scope is:

> All supported U.S. counties

State selection is optional.

The user may narrow geography by:

- selecting one or more states manually
- saying something like:
  - “Only Michigan”
  - “Michigan and Ohio”
  - “Focus on the Midwest”

Do not require the user to select a state before searching.

Do not ask:
> Which state?

unless the user's own request makes state-level clarification genuinely necessary.

---

# 4. Minimum required project information

Before showing recommendations, gather:

- capacity MW
- workload type
- target go-live year
- at least one explicit priority or hard constraint

Country does not need to be collected because it is fixed to the United States.

State is optional.

Example:

User:
> I want to build an AI data center.

Assistant:
> What power capacity are you targeting?

User:
> Around 500 MW.

Assistant:
> Is this primarily for AI training, inference, or a mix?

User:
> Mostly training.

Assistant:
> When do you need it operational?

User:
> 2030.

Assistant:
> What matters most for this project — clean energy, water resilience, climate risk, cost, or something else?

When enough information exists, transition into the decision workspace.

---

# 5. Landing page layout

Use a centered, spacious layout.

Example:

┌──────────────────────────────────────────────────────────────┐
│ Sustainable AI Infrastructure Planner                       │
│                                                              │
│      Where should you build your next AI data center?       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Tell me what you're planning to build...              │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                   [Send →]   │
│                                                              │
│  Quick examples                                              │
│  [500 MW AI Training] [Low Water Risk] [Clean Power]        │
│                                                              │
│  Geography: United States              [Choose States]       │
└──────────────────────────────────────────────────────────────┘

Keep whitespace.

Do not show advanced system information.

---

# 6. Transition to decision workspace

Once the project profile is sufficiently complete:

- keep the conversation
- reveal / transition into the map workspace
- do not reset chat
- do not open a separate unrelated dashboard

The transition should feel like:

Conversation
→ Requirements understood
→ Map appears
→ Recommendations appear

---

# 7. Main decision workspace

Desktop layout:

┌────────────────────────────────────────────────────────────────────────┐
│ Project Summary                                                        │
│ 500 MW · AI Training · 2030 · United States · All States     [Edit]   │
├─────────────────────────────────────────────────┬──────────────────────┤
│                                                 │                      │
│                                                 │ AI Decision          │
│                                                 │ Assistant            │
│                  MAP                            │                      │
│                                                 │ persistent chat      │
│                                                 │                      │
│                                                 │                      │
├─────────────────────────────────────────────────┴──────────────────────┤
│ Ranked candidate strip / selected-location summary                    │
└────────────────────────────────────────────────────────────────────────┘

Recommended proportions:

- Map: approximately 70%
- AI assistant: approximately 30%

The map is the primary workspace after intake.

---

# 8. Project summary bar

Keep the top bar compact.

Show only high-value information:

- capacity
- workload
- target year
- geography
- top priorities
- active hard constraints

Example:

500 MW · AI Training · 2030 · USA
Water: Very High · Clean Energy: Very High · Cost: Low

Use:

[Edit Criteria]

to open detailed controls.

Do not permanently show all sliders.

---

# 9. Advanced filters

Advanced filters should be hidden by default.

Open them only through:

> Edit Criteria

Use a drawer, modal, or popover.

Include:

- priorities
- hard constraints
- selected states
- target year
- capacity
- workload

The detailed filter controls should not occupy permanent screen space.

---

# 10. Chat remains active

The user can continue speaking naturally while using the map.

Examples:

> Water matters more than cost.

> Only show Michigan and Ohio.

> Avoid high wildfire risk.

> Increase capacity to 700 MW.

> Cost is now very important.

The system must:

1. interpret the message
2. update canonical project state
3. show what changed
4. rerun ranking
5. update map
6. update visible criteria
7. preserve the conversation

---

# 11. Visible changes

Never silently update decision parameters.

Show concise feedback such as:

Updated:
- Water priority: High → Very High
- Cost priority: Medium → Low

or:

Added constraint:
- Wildfire risk must remain below threshold

Keep this lightweight.

---

# 12. Map behavior

The map should show:

- top ranked candidates
- clear numbered markers where useful
- selected county
- score / rank on hover
- smooth updates when rankings change

Do not flood the screen with all 3,109 counties as equally prominent points.

Emphasize the most relevant candidates.

Selecting a county should open a clean detail area.

---

# 13. Ranked candidate strip

Below the map, show a compact shortlist.

Example:

1. County A — 88.4
2. County B — 85.7
3. County C — 84.9

Clicking a candidate selects it on the map.

Do not show a giant full ranking table by default.

---

# 14. Selected location experience

When a user selects a location, show a clean detail panel.

Example:

Washtenaw County, Michigan
Rank #2 · Score 87.1

Power Readiness       82
Water Resilience      91
Climate Resilience    88
Carbon                86
Economics             73

Strongest drivers:
✓ Water resilience
✓ Grid carbon profile
✓ Climate resilience

Actions:
[Why this location?]
[Compare]
[Evidence]

Do not expose all provenance details immediately.

---

# 15. Why this location?

The explanation graph appears only after the user asks:

> Why this location?

or clicks:

[Why this location?]

The graph should come from the deterministic backend explanation graph.

The LLM must not invent the graph.

Example:

Why Washtenaw County?

Recommended #2
│
├── Feasibility
│   ├── Water ✓
│   ├── Climate ✓
│   └── Grid readiness conditional
│
├── Strongest drivers
│   ├── Water +22.1
│   ├── Energy +19.4
│   └── Climate +14.6
│
└── Main weaknesses
    └── Cost 63/100

Tree nodes may be expandable.

---

# 16. Evidence details

Evidence should use progressive disclosure.

Default:
- simple source label
- metric
- year
- caveat

Expanded:
- raw value
- normalized score
- source URL
- transformation
- artifact/hash metadata

Do not put hashes and raw processing details in the main decision view.

---

# 17. Comparison

Comparison is secondary.

User selects:

[Compare]

Allow 2–4 counties.

Show a clean comparison view:

- rank
- score
- key factors
- exact directional differences
- feasibility status

Do not permanently keep comparison tables open.

---

# 18. Ranking changes

When the user changes criteria:

show a concise change notification.

Example:

County A: #1 → #4
County B: #3 → #1

Then allow:

[Why did this change?]

Only then show the detailed before/after contribution explanation.

Do not automatically dump the full diff.

---

# 19. Saved projects

Saved Projects is secondary navigation.

Top navigation:

[Planner] [Saved Projects]

Saved projects should support:

- reopen
- current project name
- last updated
- snapshot status

Do not keep project history constantly visible.

---

# 20. History

Project history should be available under:

Project → History

Example:

10:42 AM
Water priority: 50 → 90
County A: #1 → #4

10:46 AM
Wildfire constraint added
32 counties removed

History is not part of the main workspace.

---

# 21. Audience modes

Developer / Government / Community should change explanation language only.

They must not change:

- ranking
- score
- feasibility
- evidence
- decision trace

Keep this control inside the explanation view, not always visible.

---

# 22. Visual hierarchy

Priority order:

1. User conversation
2. Map
3. Recommended locations
4. Selected location
5. Explanation
6. Comparison
7. Evidence
8. History / audit / methodology

The UI should visually reflect this hierarchy.

---

# 23. Things to remove from permanent view

Do not permanently display:

- audit history
- provider status
- model health
- raw hashes
- normalization IDs
- scoring version
- artifact hashes
- every filter slider
- every constraint
- every raw metric
- full evidence tables
- project revisions

These can exist in advanced views.

---

# 24. Desktop-only rule

For this phase:

> Optimize only for desktop web.

Target:
- 1440x900
- similar laptop/desktop sizes

Do not spend implementation time on mobile layout.

Existing mobile functionality may remain, but desktop UX takes priority.

---

# 25. Preserve backend behavior

The redesign must not change:

- ranking logic
- scoring logic
- normalization
- feasibility semantics
- evidence/provenance semantics
- backend API contracts
- canonical project state behavior
- saved-project behavior
- deterministic explanation graph

The UI may be heavily restructured.

---

# 26. Desired emotional experience

The user should feel:

> “I can describe what I need naturally, and the system turns it into an evidence-backed infrastructure decision.”

Not:

> “I am operating a complicated GIS dashboard.”

---

# 27. Final interaction flow

The core demo should be:

User arrives
↓
Chats with AI
↓
AI gathers missing requirements
↓
Map appears
↓
Ranked U.S. candidates appear
↓
User refines criteria conversationally
↓
Map reranks
↓
User selects location
↓
User asks Why?
↓
Visual decision explanation appears
↓
User compares another location
↓
Exact trade-offs appear
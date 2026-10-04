# Repository Instructions

This repository implements the BAC x iMason sustainable AI data-center decision platform.

Before modifying product UI or interaction behavior, read:

- CODEX.md
- docs/product-specs/UX_DESIGN.md

UX_REDESIGN.md is the source of truth for the current frontend UX.

Rules:

- Preserve all existing backend APIs.
- Preserve deterministic ranking and feasibility logic.
- Preserve evidence and provenance semantics.
- Do not change dataset processing unless explicitly requested.
- Do not add ML models.
- Do not change scoring logic during UI redesign.
- Optimize for desktop web only for the current hackathon phase.
- It is acceptable to restructure or remove existing frontend components if they create clutter.
- Do not preserve old UI solely because it already exists.

After frontend changes:

- run all existing tests
- run TypeScript checks
- run production build
- run desktop browser verification
- inspect screenshots for visual quality

## Geography UX

- The product is United States only.
- New project state must default to `country = US`.
- The user must never be asked to choose a country.
- State selection is optional.
- If no state is selected, search all supported U.S. counties.
- Do not ask the user for a state unless their request explicitly requires state-level clarification.
- Preserve backend validation; satisfy geography requirements by setting the canonical frontend project geography to the United States.
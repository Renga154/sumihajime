---
description: Create or revise the implementation plan for the Tokyo relocation Todo MVP from REQUIREMENTS.md. Use before writing product code or when scope, architecture, or schedule changes.
disable-model-invocation: true
---

# Plan MVP

## Goal

Turn the approved product requirements into an executable implementation plan without writing product code.

## Required inputs

- `REQUIREMENTS.md`
- `CLAUDE.md`
- `CLAUDE_CODE_SETUP.md`
- Current repository state
- Current date and submission deadline

## Procedure

1. Inspect the repository and existing decisions.
2. Extract P0/P1/P2 requirements and acceptance criteria.
3. List assumptions, ambiguities, and blockers.
4. Define a one-municipality vertical slice first.
5. Create a data-audit plan before selecting all MVP municipalities.
6. Compare the recommended Cloudflare-native architecture with at least one viable alternative.
7. Decide boundaries for UI, rule engine, data ingestion, provenance, RAG, and operations.
8. Define data model, APIs, repository tree, and testing strategy.
9. Create milestones working backward from 2026-08-23.
10. Define scope-cut order and failure fallbacks.
11. Save the plan to `docs/IMPLEMENTATION_PLAN.md` with status `DRAFT — HUMAN APPROVAL REQUIRED`.
12. Stop and wait for human approval. Do not implement.

## Required plan sections

- Executive summary
- Assumptions and open decisions
- Scope matrix
- Municipality data-audit method
- Architecture and ADRs
- Vertical slice
- Epics, tasks, dependencies, acceptance criteria
- Data and RAG evaluation
- Privacy and security
- Test strategy
- Schedule
- Risks and fallback
- Definition of Ready

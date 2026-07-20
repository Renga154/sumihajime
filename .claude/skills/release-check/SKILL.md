---
description: Run the release gate for the Tokyo relocation Todo MVP, covering code, data provenance, RAG, privacy, security, accessibility, and demo readiness.
disable-model-invocation: true
---

# Release Check

## Gate order

1. Confirm approved implementation plan and target release scope.
2. Run formatter, lint, typecheck, unit, integration, and E2E tests.
3. Run deterministic rule regression tests.
4. Run RAG evaluation.
5. Confirm every public task has approved official sources and last verified dates.
6. Confirm source licenses and attribution.
7. Confirm unsupported municipalities/categories are clearly marked.
8. Inspect logs and analytics for PII leakage.
9. Run dependency and security checks.
10. Run mobile and keyboard accessibility smoke tests.
11. Test degraded behavior with LLM, map, and external APIs disabled.
12. Execute the fixed 1-minute demo scenario.
13. Produce a release report with blockers, warnings, and evidence.

## Blocking failures

- Unsupported procedural claim
- Missing official citation on a public task
- Cross-municipality data leak
- PII in logs
- Critical/high security issue
- Broken primary mobile flow
- RAG that cannot abstain
- Expired or unreviewed P0 source

Do not deploy while a blocking failure remains.

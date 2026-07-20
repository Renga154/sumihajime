---
description: Add or update one supported Tokyo municipality using the project's common schema, provenance, deterministic rules, and tests.
disable-model-invocation: true
---

# Add Municipality

## Preconditions

- An approved implementation plan exists.
- The municipality passed the data feasibility audit.
- P0 categories are defined.

## Procedure

1. Create the municipality manifest and coverage matrix.
2. Audit every source with `/source-audit`.
3. Save immutable raw snapshots.
4. Normalize data into shared schemas.
5. Add municipality-specific adapters only where required.
6. Add deterministic procedure rules.
7. Link every public procedure and rule to approved official sources.
8. Add positive, negative, boundary, and cross-municipality regression tests.
9. Add facilities and waste data only at the supported geographic granularity.
10. Create RAG chunks only from approved snapshots and tag them with municipality and procedure scope.
11. Run rule tests, integration tests, RAG evaluation, accessibility smoke tests, and release checks.
12. Update public coverage and data source pages.

## Completion criteria

- No public task lacks an official source.
- No unsupported category is shown as covered.
- Cross-municipality contamination tests pass.
- Last-verified dates are present.
- License attribution is present.

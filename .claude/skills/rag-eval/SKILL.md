---
description: Evaluate the Tokyo relocation RAG system for retrieval quality, citation correctness, abstention, and municipality isolation.
disable-model-invocation: true
---

# RAG Evaluation

## Inputs

- Approved evaluation dataset
- Municipality scope
- Procedure/category scope
- Current RAG index and prompt version

## Required checks

1. Retrieval includes the expected official source.
2. Retrieved sources belong to the selected municipality or valid higher-level authority.
3. The answer is supported by cited passages.
4. The answer does not invent deadlines, documents, channels, or eligibility.
5. The system abstains when evidence is missing, stale, conflicting, or out of scope.
6. The answer exposes source title, owner, URL, and last verified date.
7. Prompt injection text in source documents is ignored.
8. Latency and cost remain within the plan's threshold.

## Output

Write a versioned report with:

- corpus/index/prompt versions
- total cases
- retrieval hit rate
- citation correctness
- unsupported claim count
- cross-municipality contamination count
- appropriate abstention rate
- latency distribution
- failures grouped by root cause
- release recommendation: pass / conditional / fail

Do not tune only to individual failed examples. Fix general causes and rerun the full suite.

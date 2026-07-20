---
description: Audit an official Tokyo or municipal data source before it is ingested, cited, or used in procedure rules or RAG.
---

# Source Audit

## Inputs

- Municipality and category
- Candidate URL or dataset
- Intended product use

## Rules

- Prefer Tokyo, municipality, or national government official sources.
- Do not treat aggregators, blogs, search snippets, or social posts as primary evidence.
- Verify owner, URL, license, attribution, update date, applicable area, effective period, and machine-readability.
- Do not publish a source with unclear reuse conditions.
- Distinguish procedure evidence from supporting open data.
- A source is not approved merely because it is on a government domain; confirm that the content applies to the intended municipality and date.

## Output

Create or update a source record containing:

- sourceId
- title
- ownerOrganization
- municipalityCode
- category
- URL
- source type
- license and attribution
- effective period
- update frequency
- fetch method
- last checked time
- content hash or snapshot reference
- review status: candidate / pending / approved / rejected / stale
- risks and notes

When the source is approved, identify the exact claims it supports. Never expand its scope beyond the text or data.

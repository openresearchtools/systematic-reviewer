# Stage: Harvest

Goal: use the backend harvest action correctly.

Rules:

- If the review topic, criteria, or query draft are not written yet, update `REPORT.md` first or ask one short blocking question.
- Estimate first if the result size may be large or uncertain.
- For systematic-review projects, a real harvest run automatically merges direct Harvest child collections into `Pending`.
- When later Harvest source collections are merged manually, the same exact-ID dedupe path is used and Pending title+abstract embeddings are refreshed automatically if an embeddings model is configured.
- Boolean mode uses OpenAlex search fields and filters directly.
- Semantic mode ignores the field selector and relies on the semantic query text.
- Search filters belong in the harvest action payload, not in free text commentary.
- Top-k harvest means a real bounded `max_results` run, not a vague note.
- Boolean OpenAlex page fetches should use `page_size=200` by default.
- Semantic OpenAlex search must use page-based pagination only and can return at most `50` results total.

Good harvest examples:

```json
{
  "id": "harvest_query",
  "purpose": "Estimate the size of a focused Boolean search before importing.",
  "args": {
    "query": "\"diabetic kidney disease\" AND finerenone",
    "query_mode": "boolean",
    "field": "title_and_abstract",
    "search_mode": "estimate",
    "filters": [
      "from_publication_date:2019-01-01",
      "type:article"
    ],
    "must_have_abstract": true
  }
}
```

```json
{
  "id": "harvest_query",
  "purpose": "Import the top 50 semantically similar records for concept expansion.",
  "args": {
    "query": "finerenone diabetic kidney disease cardiovascular risk",
    "query_mode": "semantic",
    "search_mode": "limited",
    "max_results": 50,
    "filters": [
      "from_publication_date:2019-01-01",
      "type:article"
    ],
    "attachment_fetch_mode": "included_only"
  }
}
```

Failure handling:

- If the harvest action returns an error or bad query response, revise the query payload and retry.
- Do not claim records were imported until the backend confirms the job result.

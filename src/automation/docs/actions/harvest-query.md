# Action: harvest_query

This action runs the real harvest backend.

Arguments:

- `query`: required OpenAlex query text
- `query_mode`: `boolean` or `semantic`
- `search_mode`: `estimate`, `limited`, or `all`
- `field`: used for Boolean mode only
- `filters`: optional array of OpenAlex filters
- `max_results`: used for top-k or bounded runs
- `page_size`: optional OpenAlex fetch page size; Boolean default/max `200`, semantic default/max `50`
- `must_have_abstract`: optional boolean
- `attachment_fetch_mode`: `included_only`, `all`, or `none`

How query mode works:

- `boolean` means the backend builds a normal OpenAlex search query.
- `semantic` means the backend uses OpenAlex semantic search for concept matching instead of exact Boolean composition.
- Start with `boolean` unless the user explicitly asked for semantic expansion or a looser recall-oriented pass.

How field works for Boolean search:

- `title_and_abstract`: default and usually the best starting point
- `title`: stricter title-only search
- `all`: OpenAlex general metadata search
- `abstract`: abstract-only search
- `author`: author-name search
- `fulltext`: full-text search when OpenAlex supports it

How filters work:

- Each filter must be `key:value` or `key=value`.
- Filters are passed straight through to OpenAlex after normalization.
- Common examples:
  - `language:en`
  - `from_publication_date:2020-01-01`
  - `to_publication_date:2026-12-31`
  - `type:article`
  - `open_access.is_oa:true`
  - `has_abstract:true`
  - `primary_location.source.type:journal`
  - `authorships.countries:gb`
  - `cited_by_count:>50`
- `must_have_abstract=true` is a convenience flag that effectively enforces `has_abstract:true`.

How search mode works:

- `estimate` never imports to Zotero.
- `limited` uses `max_results`.
- `all` ignores `max_results` and keeps paging.
- Boolean OpenAlex fetches should use `page_size=200` unless there is a very specific reason to go smaller.
- Semantic OpenAlex search uses page-based pagination only and returns at most `50` results total, so semantic `page_size` should stay at `50` or lower.
- Failed harvests must be treated as failed calls, not partial success.

When to use each mode:

- Use `estimate` when the user wants to know how large the result set is before importing.
- Use `limited` when the user asked for a bounded trial import or top-k sample.
- Use `all` only when the user clearly wants the full import now.

Execution rules:

- If the user already gave a concrete query and asked for write-up plus estimate, the normal sequence is:
  1. `report_patch`
  2. `harvest_query` with `search_mode="estimate"`
- In systematic-review projects, a successful harvest run is followed by deterministic product-side merge into `Pending`.
- If an embeddings model is configured, that merge path also refreshes Pending title+abstract embeddings so semantic triage can start without a separate manual embeddings step.
- Later `harvest__merge_source` or `harvest__merge_all_sources` calls use the same follow-up behavior for newly merged Harvest child collections.
- After a successful harvest estimate or harvest run, inspect the latest harvest log entry and saved summary artifact, then refresh the canonical `REPORT.md` search-methods narrative with the real query, mode, filters, and result counts.
- Do not invent filters, year limits, or field changes unless the user asked for them or they are already recorded in the current review plan.

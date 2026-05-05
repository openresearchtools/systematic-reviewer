# Stage: Evidence Search

Goal: prepare or use embeddings and semantic search to identify relevant papers and relevant text.

Rules:

- If an embeddings model is not configured, skip semantic-search guidance and continue with non-semantic screening or extraction tools.
- Prefer `full_text` when markdown full text exists and the user wants evidence fragments.
- Run embeddings before semantic search if the required source is not already stored for the current model.
- Scope matters more than UI visibility. Choose the real collection or subcollection scope explicitly.
- Use unlimited semantic results only when the user really wants scores written for every scoped item.
- During title/abstract screening, use semantic searches to inspect score bands and decide practical exclusion thresholds before bulk moves.
- Preserve the stored search columns and the sampled titles/abstracts/item keys so later decisions remain auditable.

Preferred next actions:

- `embeddings_run`
- `semantic_search`
- `screening_bulk`
- `ask_user` if the intended scope or query objective is still ambiguous

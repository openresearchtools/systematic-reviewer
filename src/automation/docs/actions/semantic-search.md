# Action: semantic_search

Run semantic search over stored embeddings.

Arguments:

- `query`: required semantic query
- `search_name`: saved screening column stem
- `source_key`: embedding source to search
- `scope`, `collection_key`, or `collection_name`
- `limit`: integer or `all`

Rules:

- For `full_text`, the backend writes both the score column and a `_chunk` companion column.
- Use `limit: "all"` only when the user wants scores written for the full scope.
- Search names should be stable and human-readable because they become screening columns.

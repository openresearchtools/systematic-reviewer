# Action: embeddings_run

Run embeddings for one source and one scope.

Arguments:

- `source_key`: `title`, `abstract_note`, `title_abstract`, or `full_text`
- `scope`, `collection_key`, or `collection_name`
- `resume`: optional boolean

Rules:

- Prefer `full_text` for evidence retrieval when markdown full text exists.
- Use `resume: true` for repeat runs unless the user explicitly wants a fresh full rerun.

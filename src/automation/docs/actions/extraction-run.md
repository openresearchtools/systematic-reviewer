# Action: extraction_run

Run one extraction template over a scoped item set.

Arguments:

- `template_name` or `template_path`
- `source_key`
- `scope`, `collection_key`, or `collection_name`
- `selected_fields`
- `row_scope`
- `limit`

Rules:

- Use the named template exactly when the project already has the expected template.
- For full-text review stages, use `source_key=full_text` so the run reads retrieved markdown rather than only titles and abstracts.
- For final systematic-review data extraction, use the `Included` scope after full-text eligibility stage completion has moved eligible studies there.
- If no suitable template exists but the review stage is clear, start from the project-local seeded template pack and save the adapted review-specific template instead of stalling.
- After a run succeeds, inspect the saved extraction results and the deterministic extraction summary in `log.txt`, then refresh the relevant canonical `REPORT.md` Methods/Results sections in polished user-facing prose.

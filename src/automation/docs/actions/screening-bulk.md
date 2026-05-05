# Action: screening_bulk

Use this to move or copy many scoped items at once.

Arguments:

- `action_kind`: `move` or `filter_copy`
- `scope`, `collection_key`, or `collection_name`
- `rules`: array of column predicates
- `target_collection_name` or `target_collection_key`
- `decision`, `reason`, `notes`
- `limit`: optional

Rules:

- Bulk actions run against the full scoped set, not just visible rows.
- For move actions, prefer an explicit target collection.
- Use `Excluded` for title/abstract exclusions and `Excluded FT` for retrieved full-text eligibility exclusions.
- Do not bulk-move title/abstract survivors into `Included`; keep them in `Pending` until full-text eligibility is complete.
- Use `filter_copy` when the goal is to materialize a filter scope without changing screening state.

# Stage: Screening

Goal: move or annotate real Zotero items through scoped screening actions.

Rules:

- Screening state lives in Zotero collection membership.
- Use `screening_update` for one item.
- Use `screening_bulk` for whole-scope rules or threshold-driven moves.
- When a semantic score column already exists, bulk rules can reference that stored score instead of re-running search first.
- Preserve notes and reasons when the user asked for them.
- Title/abstract exclusions move to `Excluded` with clear reasons.
- Title/abstract survivors normally remain in `Pending`; do not move them to `Included` at title/abstract stage.
- `Included` is reserved for studies that have passed full-text eligibility after retrieval/conversion.
- When embeddings are available, inspect semantic score bands and sample records before choosing a bulk exclusion cutoff.
- Use explicit reason fields whenever exclusion logic came from semantic thresholds or template results.
- Do not create an intermediate endpoint for uncertainty. Uncertain records should stay in `Pending` while you inspect them further, preferably with traceable extraction/template results, until they can be moved to `Excluded` or kept in `Pending` for full-text retrieval.

Bulk example:

```json
{
  "id": "screening_bulk",
  "purpose": "Move clearly irrelevant title/abstract records into Excluded after traceable screening.",
  "args": {
    "action_kind": "move",
    "scope": "pending",
    "target_collection_name": "Excluded",
    "rules": [
      {
        "column_key": "title_abstract_eligible",
        "operator": "equals",
        "match_value": "no"
      }
    ],
    "reason": "Title/abstract eligibility template marked the record ineligible."
  }
}
```

When title/abstract screening is complete, use the stage-completion helper to formalize the handoff to full-text retrieval.

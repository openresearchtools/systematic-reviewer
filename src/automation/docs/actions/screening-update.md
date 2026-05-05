# Action: screening_update

Use this for one item at a time.

Arguments:

- `item_key`
- `decision`
- `target_collection_name` or `target_collection_key`
- `reason`
- `notes`

Rules:

- This changes Zotero collection membership when a move target or decision implies a move.
- Notes and reason text are overlay metadata; the review-state truth is still Zotero collection membership.
- For title/abstract screening exclusions, target `Excluded`.
- For retrieved full-text eligibility exclusions, target `Excluded FT`.
- Do not target `Included` until the item has passed full-text eligibility and has full text/markdown ready for final extraction.

# Stage: PRISMA

Goal: keep PRISMA counts aligned with the real Zotero review state and the explicit exclusion pathways used in the workflow.

Rules:

- PRISMA state is derived from the real project collections plus stored review metadata, not from a separate imagined workflow cursor.
- Title/abstract exclusions should be in `Excluded`.
- Records moved to `Excluded` with reason `full_text_not_retrieved` count as reports sought but not retrieved.
- Records moved to `Excluded FT` count as reports assessed and then excluded after full-text review.
- Records moved to `Included` count as studies that passed full-text eligibility and are ready for final extraction/synthesis.
- Recompute PRISMA with the explicit compute tool after major review-state transitions such as title/abstract completion, unretrieved full-text finalization, or full-text eligibility completion.
- Keep the PRISMA section of `REPORT.md` synchronized with the computed PRISMA state. Deterministic PRISMA compute summaries land in `log.txt`, and successful compute runs should trigger a refreshed canonical PRISMA report section.

Preferred next actions:

- `stage_completion`
- `report_patch`

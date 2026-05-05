# Stage: Full-Text Screening

Goal: decide which retrieved full-text studies remain eligible and which should move to `Excluded FT`.

Rules:

- Full-text screening only applies to studies that still live in `Pending` and now have retrieved full text or markdown.
- Create or adapt a `full-text-eligibility` extraction template before making large numbers of eligibility decisions.
- Recommended full-text eligibility templates use multiple yes/no-or-null criteria plus a separate free-text reason field.
- Items that fail full-text eligibility move to `Excluded FT`.
- Items that were never retrieved belong to `Excluded` with `full_text_not_retrieved`, not to `Excluded FT`.
- Once retrieved failures are handled, use the full-text stage-completion helper to move the remaining full-text-ready `Pending` studies into `Included`.
- After stage completion, default downstream extraction and Explore work should target `Included`.
- Move eligible studies to `Included` before final extraction and synthesis so PRISMA and study-selection reporting distinguish retrieved-and-excluded studies from included studies correctly.

Preferred next actions:

- `extraction_template`
- `extraction_run`
- `screening_update`
- `screening_bulk`
- `stage_completion`

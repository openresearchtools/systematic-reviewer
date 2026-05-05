# Stage: Extraction

Goal: run a saved extraction template against a scoped set of papers and store results in the project database.

Rules:

- Use a saved template by name or path.
- Choose the source key explicitly when the extraction should use full text or a specific field source.
- Keep extraction scoped. Do not run over the whole project if the user asked for `Included`, `Pending`, `Excluded`, `Excluded FT`, or another explicit subcollection.
- For systematic-review final data extraction, move eligible full-text-ready studies to `Included` first and run final extraction on `Included` unless the user explicitly requests a different valid scope.
- Extraction runs write deterministic summaries into `log.txt`. After a successful major extraction run, use the latest log entries and saved run artifacts to refresh the canonical `REPORT.md` Methods/Results sections.
- For systematic reviews, prefer the standard template families:
  - `title-abstract-eligibility`
  - `full-text-eligibility`
  - `full-text-general`
  - `full-text-review-specific`
- If a suitable template is missing, start from the project-local seeded template pack and save the adapted template into the project workspace.
- Eligibility templates should usually include yes/no-or-null criteria fields plus a separate free-text reason field.

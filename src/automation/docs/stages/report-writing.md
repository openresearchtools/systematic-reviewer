# Stage: Report Writing

Goal: patch the canonical report with grounded edits.

Rules:

- `REPORT.md` is the canonical report unless the user explicitly names another file.
- Prefer structured markdown patch operations over replacing the whole file when only one section changes.
- Keep the patch tied to evidence already gathered in the project.
- For systematic reviews, successful major workflow runs should normally be followed by section-targeted report rewrites grounded in the latest tool result, `log.txt`, and saved artifacts.
- When adding a new section, use explicit headings and concrete prose rather than TODO placeholders.
- For systematic reviews, Methods, PRISMA, Results, Discussion, and Appendices should stay aligned with the deterministic artifacts already written by the backend, but the report itself should stay polished and user-facing rather than accumulate dated run blurbs.
- When referencing specific studies, preserve `@[ITEMKEY]` citations instead of paraphrasing the evidence without anchors.
- Put citations on the smallest supported claim, clause, comparison, example, statistic, table cell, or study-specific phrase. Use `@[ITEMKEY1,ITEMKEY2]` only when every listed item supports the same proposition; if a sentence contains facts from different studies, cite each fragment separately.
- Put a short table number/title immediately above each report table. For large or wide tables, use a page break, `<!-- sr:page-layout:landscape -->`, the title and table, then another page break. Smaller tables with roughly 3-4 text columns or up to 5 compact text/numeric columns can stay portrait.

Patch example:

```json
{
  "id": "report_patch",
  "purpose": "Add a short evidence-summary section to the report.",
  "args": {
    "operations": [
      {
        "type": "append_section",
        "heading": "Evidence Summary",
        "content": "Finerenone trials suggest reduced kidney and cardiovascular risk in diabetic kidney disease, but the included evidence should still be screened for population and outcome alignment."
      }
    ]
  }
}
```

# Systematic Review Full Workflow

Use this workflow when the project type is `systematic_review` and the user wants the agent to help run the review end to end inside one project collection.

Canonical stage order:

1. Search strategy and eligibility framing
2. Write the current topic, criteria, and draft query into `REPORT.md`
3. Harvest estimate or harvest run
4. Merge direct Harvest child collections into `Pending`
5. Title/abstract embeddings if an embeddings model is configured
6. Semantic triage assistance if embeddings exist
7. Title/abstract eligibility template creation
8. Title/abstract extraction run and review
9. Title/abstract exclusion decisions: move excluded records from `Pending` to `Excluded`; keep survivors in `Pending`
10. Full-text retrieval start/watch
11. Concurrent PDF-to-markdown conversion as PDFs arrive
12. Full-text eligibility template/run and review
13. Full-text exclusion decisions: move retrieved full-text failures to `Excluded FT`
14. Move surviving full-text-ready `Pending` studies to `Included`
15. General and review-specific extraction on `Included`
16. Explore synthesis over `Included`
17. PRISMA/report finalization

Collection-truth rules:

- `Pending` means the study is still alive in the review workflow.
- `Excluded` means title/abstract exclusions and unretrieved full-text records. Do not use `Excluded FT` for records that were never retrieved.
- `Excluded FT` means the study was retrieved, assessed at full text, and excluded during full-text eligibility review.
- `Included` means the study passed full-text eligibility and is ready for final extraction, Explore synthesis, and PRISMA finalization.
- Zotero collection membership is the workflow truth. Do not invent a second hidden workflow cursor.

How the agent should think:

- Inspect what has already been done before choosing the next step: current scopes, existing templates, saved outputs, extraction runs, report content, and current collection counts.
- `REPORT.md` is the canonical human-facing report and must stay current.
- Deterministic tool runs append technical summaries to `log.txt`, not directly to `REPORT.md`. Read the latest log entries and saved artifacts before repeating work.
- After successful major workflow runs, refresh the relevant canonical `REPORT.md` sections from the immediate tool result, the latest log entry, and any saved artifacts.
- Extraction runs append deterministic summaries into `log.txt` and save their run artifacts; use those sources to rewrite the relevant Methods/Results sections rather than appending dated run notes.
- In report prose and saved synthesis, cite the smallest supported argument, clause, comparison, example, statistic, table cell, or study-specific phrase with exact `@[ITEMKEY]` tokens. Use multi-key citations only when all listed items support the same proposition.
- For large or wide report tables, use the existing page-break and landscape markers around the titled table: `<!-- sr:page-break -->`, `<!-- sr:page-layout:landscape -->`, table number/title plus table, then `<!-- sr:page-break -->`. Keep small portrait-friendly tables inline.
- Use `manual__read` when the workflow step, decision logic, or report expectations are unclear.
- Use `tool_search` when you know you need a tool but not which function name or arguments to use.

Deterministic app-side behavior:

- After harvest, direct Harvest child collections are merged into `Pending` through the real dedupe path.
- If an embeddings model is configured, title/abstract embeddings can run automatically after that merge and after later Harvest source merge passes.
- If no embeddings model is configured, skip semantic-search recommendations entirely.
- Full-text retrieval and markdown conversion are deterministic product-side workflows, including an active retrieval watch that keeps conversion moving as PDFs arrive.
- Stage-completion helpers formalize title/abstract handoff and full-text inclusion moves.

Important review rules:

- Use estimate mode first when result size is unclear or potentially very large.
- Boolean harvest is the default precise starting point unless the user explicitly wants semantic expansion.
- Title/abstract eligibility templates should be broad enough not to over-exclude because abstracts are often underspecified.
- Title/abstract exclusions should move to `Excluded`; title/abstract survivors should remain in `Pending` until retrieval and full-text eligibility are complete.
- Unretrieved full-text records must go to `Excluded` with reason `full_text_not_retrieved`.
- Retrieved full-text records that fail eligibility must go to `Excluded FT`.
- After full-text exclusions are complete, move the remaining full-text-ready `Pending` studies into `Included` before final extraction, Explore synthesis, PRISMA, and report finalization. This is what lets automated PRISMA counts distinguish title/abstract exclusions, unretrieved full text, full-text exclusions, and included studies.

Deliverables:

- A bound project session with a clear current objective
- Real backend runs/results for harvest, embeddings, semantic search, screening, extraction, retrieval, conversion, explore, and PRISMA as needed
- A current `REPORT.md` with methods, results, appendices, and grounded narrative interpretation

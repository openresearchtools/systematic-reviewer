# Stage: Full-Text Retrieval

Goal: retrieve PDFs/full text for the surviving `Pending` studies and keep conversion moving while retrieval is still running.

Rules:

- Start retrieval against the current `Pending` scope unless the user explicitly asks for a narrower subcollection.
- Treat full-text retrieval as a real long-running workflow, not a single instant call.
- The runtime keeps an active retrieval watch after retrieval starts, so newly arrived PDFs can be queued for markdown conversion automatically with the project's configured PDF mode.
- Use the retrieval-status tool to inspect whether Zotero is still discovering PDFs, whether the quiet window has elapsed, and how the active watch is progressing.
- Once retrieval status reports `suggested_next_action = finalize_unretrieved` or `idle_ready = true`, stop polling and finalize unretrieved items immediately.
- Queue-conversion tools remain available for explicit inspection or manual nudges, but normal retrieval runs should not wait for every retrieval attempt to finish before starting conversion.
- If full text could not be retrieved after Zotero has gone quiet, move those records to `Excluded`, not `Excluded FT`, with the stable `full_text_not_retrieved` reason.
- Deterministic retrieval and conversion summaries go to `log.txt`. After successful stage-completion runs, use the log plus saved artifacts to refresh the relevant canonical `REPORT.md` Methods/Results/Appendices sections.

Preferred next actions:

- `full_text_retrieval`
- `markdown_conversion`
- `stage_completion` only after the retrieval watch indicates that unretrieved records can be finalized safely

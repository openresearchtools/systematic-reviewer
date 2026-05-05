# Action: full_text_retrieval

Use this action family to start, inspect, and finalize the deterministic full-text retrieval workflow.

Available operations:

- start retrieval for the current scope
- inspect retrieval status and quiet-window readiness
- list retrieved and unretrieved records with item keys and citation tokens
- queue markdown conversion for newly available PDFs
- inspect queued, running, succeeded, and failed markdown conversion jobs
- finalize unretrieved items into `Excluded`
- after full-text eligibility review is complete, use stage completion to move remaining `Pending` items into `Included`

Rules:

- Scope is usually `pending`.
- Status inspection should happen before finalizing unretrieved items.
- After retrieval starts, the runtime keeps a real retrieval watch and auto-queues markdown conversion for newly discovered PDFs using the configured PDF mode.
- Status checks also report how that active watch is progressing.
- Status checks return `suggested_next_action` and `recommended_poll_after_ms` so the agent can distinguish between "wait a bit longer" and "the quiet window is satisfied, finalize unretrieved now".
- When status returns `suggested_next_action = finalize_unretrieved` or `idle_ready = true`, do not keep polling; call the finalize-unretrieved tool next.
- Use the item-list helper when you need to inspect exactly which studies still lack PDFs or which ones were retrieved.
- Use the conversion-status helper when you need to know whether markdown conversion is still running or has already finished for the current scope.
- Only finalize unretrieved items after Zotero is quiet and no new PDFs are appearing.
- Unretrieved studies go to `Excluded` with the `full_text_not_retrieved` reason so PRISMA can count them correctly.
- Full-text inclusion completion belongs only after retrieved-but-ineligible studies have already been moved to `Excluded FT`.
- Deterministic retrieval and conversion tools append technical summaries to `log.txt`; after successful stage-completion runs, use the log and saved artifacts to refresh the canonical `REPORT.md` study-selection narrative instead of duplicating dated procedure notes.

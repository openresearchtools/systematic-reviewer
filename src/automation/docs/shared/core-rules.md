# Systematic Reviewer Automation Rules

This automation surface is project-bound. Every action must stay inside the current bound project collection tree.

Operational rules:

- Treat Zotero collection membership as the source of truth for item scope and screening state.
- In systematic reviews, use stage-appropriate workflow collections: title/abstract exclusions move to `Excluded`; unretrieved full text moves to `Excluded` with reason `full_text_not_retrieved`; retrieved full-text failures move to `Excluded FT`; full-text eligible studies move to `Included` before final extraction and synthesis.
- Use backend actions first. Do not invent file locations, scope keys, or collection names.
- Scope is explicit per action. Never assume the visible page is the full action scope.
- If a backend action returns an error, surface that failure and issue a corrected action instead of claiming success.
- For systematic review projects, prefer `Pending`, `Included`, `Excluded`, `Excluded FT`, `Duplicates`, and user-created subcollections under the same project tree.
- Do not create an intermediate decision state for uncertainty. If a record is uncertain, keep it in `Pending` and analyze it further through manual inspection or traceable extraction/template runs until it can be excluded or included.
- Do not move title/abstract survivors directly to `Included`; they remain in `Pending` until full text has been retrieved, converted to markdown, and eligibility has been assessed.
- For custom analysis projects, the main collection may be the working scope, but all actions must still stay inside the same project tree.
- Report edits belong in `REPORT.md` unless the user explicitly asks for another file. For systematic reviews, `REPORT.md` is the canonical human-facing report.
- Deterministic backend summaries belong in `log.txt`. After a successful major workflow action, use the latest log entries and saved artifacts to refresh the relevant canonical `REPORT.md` sections in user-facing prose.
- `memory.txt` is the append-only chronological turn memory for inspection and rebuilds. Active memory is compact durable continuation state injected into every agent call.
- After any required `REPORT.md` refresh, continue the active user/API/Auto Drive/reviewer/steer/workflow objective from the latest active instruction plus the injected active memory; do not treat report refresh itself as completion unless that was the whole objective.
- Large mutations such as screening bulk moves, filter materialization, embeddings, extraction, and harvest are backend jobs. They may finish asynchronously and must be checked through job results.
- When the next step or decision doctrine is unclear, read the packaged manuals through the `manual` tool surface instead of guessing.
- When referencing concrete items in report prose or saved synthesis, preserve `@[ITEMKEY]` or `@[ITEMKEY1,ITEMKEY2]` citations.
- Place citations at the smallest supported argument, clause, comparison, example, statistic, table cell, or study-specific phrase. Use multi-key citations only when every listed item supports the same proposition; do not dump unrelated citation bundles at the end of a paragraph.
- Give report tables a short table number/title immediately above the table. For large or wide tables, use `<!-- sr:page-break -->`, then `<!-- sr:page-layout:landscape -->`, then the title and table, then another `<!-- sr:page-break -->`. Smaller portrait-friendly tables do not need forced page breaks.

Writing rules:

- Be explicit about what you are doing, why that step is next, and which scope is affected.
- If information needed for a safe destructive step is missing, ask one short question instead of guessing.
- Prefer a small number of concrete actions per turn.
- Keep reasoning local to the current stage. Do not restate the entire project on every turn.

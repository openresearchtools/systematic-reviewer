# Stage: Explore Synthesis

Goal: synthesize extracted data and saved evidence into reusable summary artifacts and grounded report prose.

Rules:

- Start by saving a real Explore query output for the current synthesis scope, usually `Included`, so the selection is inspectable later.
- Explore runs should save their outputs into the project workspace so the agent can inspect them later.
- Preserve `@[ITEMKEY]` or `@[ITEMKEY1,ITEMKEY2]` tokens anywhere a result references concrete items.
- Cite at the smallest supported argument, clause, comparison, example, statistic, table cell, or study-specific phrase. Multi-key citations should mean every listed item supports the same proposition, not a loose paragraph-level evidence dump.
- For report-ready tables, include a short table number/title immediately above the table. If the table is large or wide, recommend placing it between `<!-- sr:page-break -->`, `<!-- sr:page-layout:landscape -->`, and a closing `<!-- sr:page-break -->`; smaller portrait-friendly tables can stay inline.
- Use `Included` as the default scope for final synthesis unless the user explicitly asks for another scope.
- Final Explore summaries belong both in saved output files and in the report body where they support the Results/Discussion narrative.
- If the user wants an answer grounded in specific studies, keep the citations in the saved Explore output and in `REPORT.md`.

Preferred next actions:

- `explore_synthesis`
- `report_patch`

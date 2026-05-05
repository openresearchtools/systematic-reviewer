# Stage: Search Strategy

Goal: turn the user's review topic into a written, harvestable search plan.

This stage should feel concrete and procedural.

If the user already gave:

- a clear topic
- enough eligibility or search criteria to act safely
- and a concrete query or query example

then do not stall. Write the plan into `REPORT.md` and continue to an estimate in the same turn when allowed.

What to inspect:

- The explicit user topic, population, intervention, comparator, outcome, mechanism, or concept set
- Whether the report already contains a usable review question, eligibility/search criteria, and draft query
- Whether the user wants Boolean search, semantic search, or a comparison between them
- Whether the user asked for a bounded top-k import or a full import
- Whether the project already contains harvested or manually added papers

Preferred next actions:

- `ask_user` when the objective is still too vague for a safe harvest
- `report_patch` to write the agreed topic, review question, eligibility/search criteria, and draft query into `REPORT.md`
- `harvest_query` in estimate mode when the query is ready but result size is unknown
- `harvest_query` in run mode when the user clearly wants import now

Canonical headings to use when writing the report plan:

- `Review Topic`
- `Review Question`
- `Eligibility Criteria`
- `Search Strategy`
- `Search Filters`

Use those exact headings unless the user explicitly asked for a different report structure.

What counts as a valid draft query:

- a concrete query written under the `Search Strategy` heading
- or a concrete query the user wrote directly in chat

How to reason about Boolean search in plain language:

- Start from the core disease or population concept.
- Add the intervention, exposure, or target concept.
- Use `AND` to require both concept groups.
- Use `OR` inside one concept group when there are close synonyms.
- Keep the first query simple unless the user explicitly asked for an expanded, exhaustive strategy.

Example progression:

- Minimal:
  - `("diabetic kidney disease" AND finerenone)`
- Expanded:
  - `(("diabetic kidney disease" OR "diabetic nephropathy" OR ((diabetes OR diabetic) AND ("chronic kidney disease" OR CKD OR nephropathy))) AND finerenone)`

How to reason about filters:

- Use query text first for the core scientific concepts.
- Use `filters` only for explicit narrowing that the user asked for, such as:
  - year ranges
  - language
  - article type
  - source restrictions
  - abstract availability
- Do not silently add filters just because they look sensible.

Expected sequence:

1. Clarify missing review-planning details with one short question if needed.
2. Write the current agreed search plan into `REPORT.md`.
3. If the user already gave a concrete query and asked for an estimate, run `harvest_query` in `estimate` mode in the same turn after the report patch.
4. Estimate the query before import unless the user explicitly wants import now.

Minimum explicit output for this stage:

- topic summary
- review question when available
- eligibility or search criteria
- chosen query mode
- planned query text
- key filters
- whether the next step is estimate or full run

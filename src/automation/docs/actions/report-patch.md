# Action: report_patch

Patch `REPORT.md` with structured markdown operations.

Arguments:

- `operations`: the same structured markdown operations accepted by report patching

Recommended operation types:

- `append_section`
- `prepend_section`
- `replace_section`
- `replace_section_body`
- `delete_section`

Rules:

- Patch only the canonical report unless the user explicitly asks for another file.
- Prefer small, targeted edits.
- Do not destroy existing sections without a clear user instruction.
- `replace_section` and `replace_section_body` preserve existing `<!-- systematic-reviewer:... -->` workflow artifact blocks unless you explicitly include replacement blocks yourself.

When used during search strategy, prefer headings such as:

- `Review Topic`
- `Review Question`
- `Eligibility Criteria`
- `Search Strategy`

# Action: stage_completion

Use explicit stage-completion helpers when the review is ready to advance and the collection moves must be performed correctly.

Rules:

- Title/abstract completion should formalize the handoff from title/abstract screening to full-text retrieval.
- Before title/abstract completion, title/abstract exclusions should already have been moved to `Excluded`, while survivors remain in `Pending`.
- Full-text completion should happen only after full-text eligibility failures have been moved to `Excluded FT`.
- Full-text completion moves the remaining `Pending` studies into `Included` and changes the default downstream synthesis scope to `Included`.
- Full-text completion should run before final extraction/Explore/PRISMA finalization so `Included` contains the final eligible study set.
- Stage-completion helpers should be preferred over ad hoc collection moves when the action exists, because they encode the deterministic product-side transition.

## What and why

<!-- One or two sentences. Link the issue or SPEC section if relevant. -->

## Area

<!-- Which workspace(s): packages/schema, noiser, dataer, cascade, api, frontend, ... -->

## Definition of done

- [ ] A test proves the change (new or updated); it failed before the change.
- [ ] `pnpm verify:fast` is green locally.
- [ ] `pnpm verify` is green locally.
- [ ] Contract change in `packages/schema`? Owner has been told and approved it: <!-- name / N/A -->
- [ ] Prompts touched? `pnpm evals` (offline) still passes; cache re-recorded by the agreed person if needed.
- [ ] No `.env`, `out/`, or unrelated generated files in the diff.
- [ ] Branch rebased on `main`; no force push used.

## Notes for reviewer

<!-- Anything non-obvious: trade-offs, what you deliberately did not do. -->

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Decisions

Short log of team decisions that affect more than one workspace. One entry each, newest on top. Do not rewrite old entries; add a new one that supersedes them.

Template:

```
## YYYY-MM-DD — <short title>
- **Decision:** …
- **Why:** …
- **Who:** …
- **Affects:** <workspaces / files>
```

## 2026-11-27 — Team workflow and branch protection

- **Decision:** `main` is protected; changes go through PRs with green `verify` CI. Agents work on feature branches and ask before contract, push or paid-API actions (see AGENTS.md).
- **Why:** four people and agents commit to the same repo, and `main` currently has no protection, so a direct push can land unreviewed.
- **Who:** team (proposed in PR `chore/team-workflow`).
- **Affects:** `AGENTS.md`, `.github/`, `.claude/settings.json`.

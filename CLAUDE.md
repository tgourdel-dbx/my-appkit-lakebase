# Development workflow

This repository uses Git worktrees, Lakebase database branches, and GitHub
pull requests.

Each Claude worktree session works on its own Git branch and a matching
Lakebase Postgres branch (a copy-on-write clone of production), then opens a
pull request. When the PR is opened, GitHub Actions automatically deploys a
per-PR preview app to Databricks Apps, backed by a fresh Lakebase branch
cloned from production. Both are torn down automatically when the PR closes.

## Feature development

When running inside a Claude worktree, work only on the Git branch assigned
to this worktree.

Do not switch branches.

The environment variable `LAKEBASE_BRANCH` identifies the Lakebase database
branch assigned to this worktree. Only modify that Lakebase branch.

Never connect directly to or modify the production Lakebase branch
(`production`). Never use production database credentials. Never delete
Lakebase branches manually. This worktree's branch is cleaned up
automatically: the `Cleanup Lakebase Branch` GitHub Action deletes it when
its PR is closed, and a 30-day TTL reclaims it as a safety net if no PR is
ever opened.

Never create or delete Databricks Apps manually. The per-PR preview app is
created and deleted only by GitHub Actions (`Deploy Lakebase Preview` and
`Cleanup Lakebase Branch`); do not deploy or delete it by hand.

## Database changes

All schema changes must be represented by migration files committed to Git.

When database changes are required:

1. Verify `AGENT_ENV=lakebase-preview`.
2. Verify `LAKEBASE_BRANCH` is defined.
3. Apply changes only against that branch.
4. Run migrations and tests against that branch.
5. Commit the migration with the application code.

Never apply migrations directly to production.

## Pull requests

For feature work:

1. Implement the requested functionality.
2. Run relevant tests, linting, and type checking.
3. Make a coherent commit.
4. Push the current branch to origin.
5. If the current branch has no pull request, create a draft pull request.
6. Continue working on the same branch and pull request.
7. Push subsequent commits as needed.
8. Once implementation and checks are complete, mark the PR ready for review.

A feature task is not complete until:

- changes are committed
- changes are pushed
- a pull request exists
- automated checks pass
- the pull request is ready for review

Do not merge your own pull request.

### Pull request creation

Use `gh pr view` to determine whether a PR already exists.

If none exists:

    gh pr create --draft --fill

When finished:

    gh pr ready

## Before completion

Run the project's standard checks:

    npm run typecheck
    npm run lint
    databricks apps validate --profile <PROFILE>

Review:

    git status
    git diff origin/main...HEAD

Then push all final commits and verify:

    gh pr checks

Report the PR URL when complete. Opening the PR triggers the
`Deploy Lakebase Preview` GitHub Action, which deploys a preview app
(`appkit-lakebase-pr-<number>`) on a fresh `pr-<number>` Lakebase branch and
comments the preview URL on the PR. Closing or merging the PR triggers the
`Cleanup Lakebase Branch` GitHub Action, which deletes the preview app, the
`pr-<number>` branch, and this worktree's Lakebase branch. If a PR is never
opened, each branch's 30-day TTL reclaims it as a backstop.

<!-- appkit-instructions-start -->
## Databricks AppKit

This project uses Databricks AppKit packages. For AI assistant guidance on using these packages, refer to:

- **@databricks/appkit** (Backend SDK): [./node_modules/@databricks/appkit/CLAUDE.md](./node_modules/@databricks/appkit/CLAUDE.md)
- **@databricks/appkit-ui** (UI Integration, Charts, Tables, SSE, and more.): [./node_modules/@databricks/appkit-ui/CLAUDE.md](./node_modules/@databricks/appkit-ui/CLAUDE.md)

### Databricks Skills

For enhanced AI assistance with Databricks CLI operations, authentication, data exploration, and app development, install the Databricks skills:

```bash
databricks aitools install
```
<!-- appkit-instructions-end -->

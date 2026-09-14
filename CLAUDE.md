# Development workflow

This repository uses Git worktrees, Lakebase database branches, and GitHub
pull requests.

Each Claude worktree session works on its own Git branch and a matching
Lakebase Postgres branch (a copy-on-write clone of production), then opens a
pull request. There is no per-PR Databricks Apps preview environment.

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

Never create or delete Databricks Apps manually.

## Database changes

All schema changes must be represented by
[`node-pg-migrate`](https://github.com/salsita/node-pg-migrate) migration files
in `migrations/`, committed to Git alongside the application code. Never change
the schema by hand and never create tables at app boot — the migration files
are the single source of truth, replayed identically against every branch
(preview and production).

Migrations must be **idempotent and additive**: a migration that fails on
re-apply is a bug. For renames/removals use the expand/contract pattern (add
the new column, migrate readers, then drop the old one in a later migration) so
the running app code stays compatible across the deploy.

When database changes are required:

1. Verify `AGENT_ENV=lakebase-preview`.
2. Verify `LAKEBASE_BRANCH` is defined.
3. Load the connection environment for this worktree's preview branch:
   `eval "$(bash scripts/lakebase-connect-env.sh "$LAKEBASE_BRANCH_RESOURCE")"`
4. Author the migration (`npm run migrate:create -- <name>` scaffolds
   `migrations/<ts>_<name>.js`) and apply it with `npm run migrate:up`
   (`npm run migrate:down` rolls back the most recent one).
5. Run tests against that branch (`npm test`).
6. Commit the migration with the application code.

Never apply migrations directly to production. Production is migrated only by
the `Migrate Production` GitHub Action on merge to main, replaying the same
committed files that `Migrate & Test (Preview Branch)` already applied and
tested on the PR's preview branch.

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

Report the PR URL when complete. Closing or merging the PR triggers the
`Cleanup Lakebase Branch` GitHub Action, which deletes this worktree's
Lakebase branch. If a PR is never opened, the branch's 30-day TTL reclaims
it as a backstop.

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

# Development workflow

This repository uses Git worktrees, Lakebase database branches, GitHub pull
requests, and Databricks Apps preview environments.

## Feature development

When running inside a Claude worktree, work only on the Git branch assigned
to this worktree.

Do not switch branches.

The environment variable `LAKEBASE_BRANCH` identifies the Lakebase database
branch assigned to this worktree. Only modify that Lakebase branch.

Never connect directly to or modify the production Lakebase branch
(`production`). Never use production database credentials. Never delete
Lakebase branches.

Never create or delete Databricks Apps manually. GitHub Actions owns the
preview application lifecycle.

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

Report the PR URL when complete. Opening the draft PR triggers the
`PR Preview` GitHub Action, which deploys `appkit-lakebase-pr-<N>` from the
exact PR commit, bound to this worktree's Lakebase branch, and comments the
preview URL on the PR. Closing/merging the PR triggers `Cleanup PR Preview`,
which destroys the app and deletes the Lakebase branch.

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

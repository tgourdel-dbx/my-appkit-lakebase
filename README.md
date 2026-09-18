# appkit-lakebase

A Databricks App powered by [AppKit](https://developers.databricks.com/docs/appkit/v0/), featuring React, TypeScript, and Tailwind CSS.

**Enabled plugins:**
- **Lakebase** -- Fully managed Postgres database for transactional (OLTP) workloads on Databricks
- **Server** -- Express HTTP server with static file serving and Vite dev mode

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI (for deployment)
- Access to a Databricks workspace
- For the per-PR preview pipeline: a CI service principal with the
  `workspace-access` entitlement and `CAN_MANAGE` on the Lakebase project, the
  GitHub Actions variables/secrets, and a one-time schema grant on `production`
  — see [One-time setup for the preview pipeline](#one-time-setup-for-the-preview-pipeline).

## Databricks Authentication

### Local Development

For local development, configure your environment variables by creating a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and set the environment variables you need:

```env
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_APP_PORT=8000
# ... other environment variables, depending on the plugins you use
```

#### Lakebase Configuration

The Lakebase plugin requires additional environment variables for PostgreSQL connectivity. To learn how to configure the Lakebase plugin, see the [Lakebase plugin documentation](https://developers.databricks.com/docs/appkit/v0/plugins/lakebase).

### CLI Authentication

The Databricks CLI requires authentication to deploy and manage apps. Configure authentication using one of these methods:

#### OAuth U2M

Interactive browser-based authentication with short-lived tokens:

```bash
databricks auth login --host https://your-workspace.cloud.databricks.com
```

This will open your browser to complete authentication. The CLI saves credentials to `~/.databrickscfg`.

#### Configuration Profiles

Use multiple profiles for different workspaces:

```ini
[DEFAULT]
host = https://dev-workspace.cloud.databricks.com

[production]
host = https://prod-workspace.cloud.databricks.com
client_id = prod-client-id
client_secret = prod-client-secret
```

Deploy using a specific profile:

```bash
databricks bundle deploy --profile production
```

**Note:** Personal Access Tokens (PATs) are legacy authentication. OAuth is strongly recommended for better security.

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development

Run the app in development mode with hot reload:

```bash
npm run dev
```

The app will be available at the URL shown in the console output.

### Build

Build both client and server for production:

```bash
npm run build
```

This creates:

- `dist/server.js` - Compiled server bundle
- `client/dist/` - Bundled client assets

### Production

Run the production build:

```bash
npm start
```

## Code Quality

There are a few commands to help you with code quality:

```bash
# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:fix
```

## Development Workflow

This repository uses **Git worktrees**, **Lakebase database branches**, and
**GitHub pull requests** so that every feature is built and tested in
isolation — against a copy-on-write clone of the production database — and
never touches production until it is reviewed and merged.

### How it fits together

```
main checkout ────────────────► production Lakebase branch (never modified)
      │                                    │
      │  each feature gets its own         │ (fresh copy-on-write clone
      │  worktree                          │  per pull request)
      ▼                                    │
Claude worktree (git branch: feat_add_charts)
      │                                    │
      │  SessionStart hook clones prod     │
      ▼                                    │
Lakebase branch: feat-add-charts           │
  (copy-on-write, 30-day TTL)              │
      │                                    │
      │  implement · migrate · test        │
      │  commit · push                     │
      ▼                                    ▼
GitHub pull request ──────────► "Deploy Lakebase Preview" Action
  (draft ─► ready for review)      • Lakebase branch: pr-123 (clone of prod)
      │                            • migrations applied to pr-123
      │                            • preview app: appkit-lakebase-pr-123
      │                            • preview URL commented on the PR
      │
      │  PR closed / merged
      ▼
"Cleanup Lakebase Branch" Action
  deletes preview app + pr-123 + feat-add-charts
```

Each worktree session works on **one Git branch** and a **matching Lakebase
Postgres branch**. You never switch branches inside a worktree, and you never
connect to or modify the `production` Lakebase branch.

### 1. A worktree provisions its own database branch

When a Claude session starts inside a worktree, the `SessionStart` hook
([`.claude/hooks/setup-lakebase.sh`](.claude/hooks/setup-lakebase.sh))
provisions a Lakebase branch cloned from `production` and exports its
identifiers to the session:

```text
Agent database environment:
  Git branch:      feat_add_charts
  Lakebase branch: feat-add-charts
  Database:        projects/appkit-lakebase-db/branches/feat-add-charts/databases/databricks-postgres
```

The Git branch name is normalized into a valid Lakebase branch id (RFC 1123:
lowercase, `[a-z0-9-]` only, ≤ 63 chars) by
[`scripts/branch-name.sh`](scripts/branch-name.sh), which is shared by the hook
and the cleanup Action so both always resolve to the same id:

```bash
$ scripts/branch-name.sh feat_add_charts
feat-add-charts

$ scripts/branch-name.sh Fix/BUG-123_edge
fix-bug-123-edge
```

The session gets these environment variables (secrets are **not** exported):

| Variable                  | Example                                              |
| ------------------------- | ---------------------------------------------------- |
| `AGENT_ENV`               | `lakebase-preview`                                   |
| `LAKEBASE_PROJECT_ID`     | `appkit-lakebase-db`                                 |
| `LAKEBASE_PARENT_BRANCH`  | `production`                                         |
| `LAKEBASE_BRANCH`         | `feat-add-charts`                                    |
| `LAKEBASE_BRANCH_RESOURCE`| `projects/appkit-lakebase-db/branches/feat-add-charts` |

The main checkout is **not** a worktree, so the hook does nothing there:

```text
Main checkout detected. Lakebase preview provisioning skipped.
```

### 2. Database changes are migrations against the preview branch

All schema changes must be committed as migration files. Before applying them:

```bash
# 1. Confirm you are in a preview environment, not production.
echo "$AGENT_ENV"        # -> lakebase-preview
echo "$LAKEBASE_BRANCH"  # -> feat-add-charts (must be set)

# 2. Apply and test migrations only against that branch, then commit
#    the migration together with the application code.
```

Never apply migrations to `production` by hand, and never delete Lakebase
branches manually — both are automated (production migration below; cleanup in
step 5).

**Production stays in sync automatically.** When migrations land on `main` (i.e.
a PR merges), the **Migrate Lakebase Production** workflow
([`.github/workflows/lakebase-migrate-prod.yml`](.github/workflows/lakebase-migrate-prod.yml))
runs `npm run migrate` against the `production` branch. This is essential:
because every `pr-<n>` preview branch is a clone of `production`, a merged
schema change that never reached `production` would be missing from all future
previews. The workflow runs as the CI service principal, which must be able to
apply migrations to the production schema (see the one-time setup in step 4 of
the preview section).

### 3. Open and iterate on a pull request

Run the standard checks, commit, push, and open a **draft** PR:

```bash
npm run typecheck
npm run lint

git add -A
git commit -m "Add charts to the dashboard"
git push -u origin feat_add_charts

# Create the PR only if one does not already exist.
gh pr view >/dev/null 2>&1 || gh pr create --draft --fill
```

Keep working on the same branch and push follow-up commits. When the
implementation is done and checks pass, mark it ready and confirm CI:

```bash
gh pr ready
gh pr checks
```

Do **not** merge your own pull request.

### 4. A live preview app is deployed for the PR

Opening (or pushing to) a PR triggers the **Deploy Lakebase Preview** Action
([`.github/workflows/lakebase-preview.yml`](.github/workflows/lakebase-preview.yml)).
It gives every PR its own running app on Databricks Apps, backed by its own
database — so reviewers can click a link and exercise the change against
real-shaped data, in full isolation from production and from every other PR.

```yaml
on:
  pull_request:
    types: [opened, reopened, synchronize]
```

For a PR numbered `123`, the workflow:

1. **Clones the database.** Creates a fresh Lakebase branch `pr-123` as a
   copy-on-write clone of `production` (skipped if it already exists), so the
   preview starts from a clean copy of production data every time the PR is
   opened.

   ```bash
   databricks postgres create-branch projects/appkit-lakebase-db pr-123 \
     --json '{"spec":{"source_branch":"projects/appkit-lakebase-db/branches/production","ttl":"2505600s"}}'
   ```

2. **Applies migrations — if the PR ships them.** If the PR's code exposes an
   `npm run migrate` script (the `node-pg-migrate` setup that connects via
   `@databricks/lakebase`), it runs against `pr-123` before the app comes up.
   Until migration tooling lands on the branch, this step is a no-op.

3. **Deploys the preview app.** Deploys the `preview` bundle target
   (see [`databricks.yml`](databricks.yml)), which names the app
   `appkit-lakebase-pr-123`, deploys the PR's head branch, and wires its
   `postgres` resource to `pr-123`.

   ```bash
   databricks bundle deploy -t preview --var pr_number=123 --var git_branch=feat_add_charts
   databricks bundle run    app -t preview --var pr_number=123 --var git_branch=feat_add_charts
   ```

4. **Comments the preview URL** back on the PR (upserting a single comment as
   new commits are pushed).

#### One-time setup for the preview pipeline

The preview and cleanup workflows run unattended, so they authenticate as a
**Databricks service principal** via OAuth M2M. Before the first preview can
run, complete these one-time steps (each is done once, not per PR).

**1. Create the CI service principal.** In the workspace, create (or reuse) a
service principal and generate an **OAuth secret** (client id + secret). This
is the identity all preview/cleanup runs act as.

**2. Grant it the `workspace-access` entitlement.** Settings → *Identity and
access* → *Service principals* → your SP → *Entitlements* → enable **Workspace
access**. Without it, Lakebase API calls fail with *"This API is disabled for
users without the workspace-access entitlement."* CLI equivalent:

```bash
databricks service-principals patch <SP_SCIM_ID> --json '{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [{ "op": "add", "path": "entitlements", "value": [{ "value": "workspace-access" }] }]
}'
```

**3. Give it access on the Lakebase (Postgres) project.** The SP must be able
to create and delete branches on the `appkit-lakebase-db` project, which
requires **Can Manage** on the project. Add it in the project's permissions UI,
or via CLI:

```bash
databricks permissions update database-projects appkit-lakebase-db --json '{
  "access_control_list": [
    { "service_principal_name": "<SP_CLIENT_ID>", "permission_level": "CAN_MANAGE" }
  ]
}'
```

> `CAN_MANAGE` is the control-plane permission to create and delete branches —
> that is all the CI service principal needs. It does **not** need any
> in-database Postgres role or `databricks_superuser` membership.

**4. Configure GitHub Actions variables & secrets** (repository or org level):

| Kind      | Name                       | Purpose                                        |
| --------- | -------------------------- | ---------------------------------------------- |
| Variable  | `DATABRICKS_HOST`          | Workspace URL                                  |
| Variable  | `DATABRICKS_CLIENT_ID`     | Service principal client id                    |
| Variable  | `LAKEBASE_PROJECT_ID`      | Lakebase project (e.g. `appkit-lakebase-db`)   |
| Variable  | `PGHOST`                   | Postgres host (only needed for the migrate step) |
| Secret    | `DATABRICKS_CLIENT_SECRET` | Service principal OAuth secret                 |

**5. Grant the app access to its schema — once, on `production`.** A preview app
connects with `CAN_CONNECT_AND_CREATE`, but the `app` and `appkit` schemas it
uses are cloned from production and owned there by another role, so the app's SP
needs **DML access** granted (otherwise it fails with `permission denied for
schema`). Because a branch clone inherits production's Postgres grants, grant
this **once** on the `production` branch — as the schema owner, via the Lakebase
SQL editor — and every future preview inherits it:

```sql
-- run ONCE on the production branch, database databricks_postgres
GRANT USAGE ON SCHEMA app, appkit TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app    TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA appkit TO PUBLIC;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA app    TO PUBLIC;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA appkit TO PUBLIC;
```

Schema **changes** are handled separately by migrations: the *Migrate Lakebase
Production* workflow (step 2) applies them to `production` on merge, so previews
cloned afterward already have the current schema. This is why **no per-PR grant,
ownership transfer, or `databricks_superuser` is needed** — the app reads/writes
via the inherited grants, and migrations (not the app or the preview pipeline)
own schema evolution.

> The app template also runs an idempotent `CREATE TABLE`/`ALTER TABLE` at
> startup (`server/routes/lakebase/todo-routes.ts`). Since the app's SP doesn't
> *own* the cloned tables, that step logs a benign `must be owner` warning and
> is skipped — harmless, because migrations already applied the schema. Moving
> that logic fully into migrations would remove the warning.

### 5. Cleanup happens automatically

Closing or merging the PR triggers the **Cleanup Lakebase Branch** Action
([`.github/workflows/lakebase-cleanup.yml`](.github/workflows/lakebase-cleanup.yml)),
which tears down everything the PR created — the preview app, its `pr-123`
branch, and the per-worktree branch (recomputed with the same
`branch-name.sh` script):

```yaml
on:
  pull_request:
    types:
      - closed
```

`.github/settings.yml` also sets `delete_branch_on_merge: true`, so the Git
branch is removed on merge. As a safety net, each Lakebase branch carries a
**30-day TTL** that reclaims it even if a PR is never opened.

### Guardrails

- Work only on the branch assigned to this worktree — do not switch branches.
- Only modify the Lakebase branch named by `LAKEBASE_BRANCH`.
- Never connect to or modify the `production` Lakebase branch, and never use
  production database credentials.
- Never create or delete Databricks Apps or Lakebase branches manually.

## Deployment with Databricks Asset Bundles

### 1. Configure Bundle

Update `databricks.yml` with your workspace settings:

```yaml
targets:
  default:
    workspace:
      host: https://your-workspace.cloud.databricks.com
```

Make sure to replace all placeholder values in `databricks.yml` with your actual resource IDs.

### 2. Deploy

Deploy and start the app with a single command:

```bash
databricks apps deploy
```

`databricks apps deploy` validates the project, deploys it, starts the app, and prints its URL.

### Deploy to Production

1. Configure the production target in `databricks.yml`
2. Deploy to production:

```bash
databricks apps deploy -t prod
```

> **Restarting a stopped app:** apps stop after a period of inactivity. To start one again without redeploying, run `databricks apps start <APP_NAME>`.

## Project Structure

```
* client/          # React frontend
  * src/           # Source code
  * public/        # Static assets
* server/          # Express backend
  * server.ts      # Server entry point
  * routes/        # Routes
* shared/          # Shared types
* databricks.yml   # Bundle configuration
* app.yaml         # App configuration
* .env.example     # Environment variables example
```

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: React.js, TypeScript, Vite, Tailwind CSS, React Router
- **UI Components**: Radix UI, shadcn/ui
- **Databricks**: AppKit SDK

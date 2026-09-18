# appkit-lakebase

A working example of a **branch-per-pull-request software development lifecycle**
for a Databricks App backed by Lakebase (managed Postgres). Every change is
developed in its own Git worktree against a copy-on-write clone of the
production database, and every open pull request gets its own live preview app
wired to its own database branch — provisioned and torn down automatically.

The application itself (an [AppKit](https://developers.databricks.com/docs/appkit/v0/)
React todo app) is deliberately minimal. This README documents the workflow
around it; for the app and framework, see the AppKit docs and
[Running locally](#running-locally).

## What gets branched

Three layers are branched together, one set per unit of work, and kept in
lockstep:

| Layer    | Production                          | Per feature / PR                    |
| -------- | ----------------------------------- | ----------------------------------- |
| Git      | `main`                              | a feature branch in its own worktree |
| Database | `production` Lakebase branch        | a copy-on-write clone               |
| App      | `appkit-lakebase`                   | `appkit-lakebase-pr-<n>`            |

The database clone is the key piece. A Lakebase branch is copy-on-write, so it
is created in seconds, starts from real-shaped production data, and is fully
isolated — writes never touch production or any other branch. That lets a
feature (and its reviewers) exercise schema and data changes safely, and lets
the change be thrown away cleanly when the PR closes.

## How a change flows

```
main checkout ────────────────► production Lakebase branch (never modified)
      │                                    │
      │  each feature gets a worktree      │ (copy-on-write clone per branch)
      ▼                                    ▼
worktree (git branch: feat_add_charts)     Lakebase branch: feat-add-charts
      │  implement · migrate · test        │  (30-day TTL backstop)
      │  commit · push                     │
      ▼                                    │
GitHub pull request ──────────► Deploy Lakebase Preview
      │                            • Lakebase branch pr-123 (fresh prod clone)
      │                            • migrations applied to pr-123
      │                            • app appkit-lakebase-pr-123 deployed
      │                            • preview URL commented on the PR
      │  merge ──────────────────► Migrate Lakebase Production (schema → prod)
      │  close / merge
      ▼
Cleanup Lakebase Branch ───────► deletes the preview app, pr-123,
                                  feat-add-charts, and the Git branch
```

A worktree session works on exactly one Git branch and one matching Lakebase
branch; it never switches branches and never touches `production`.

## Provisioning a worktree

Starting a Claude session inside a worktree runs the `SessionStart` hook
([`.claude/hooks/setup-lakebase.sh`](.claude/hooks/setup-lakebase.sh)), which
clones a Lakebase branch from `production` and exports its identifiers to the
session:

```text
Agent database environment:
  Git branch:      feat_add_charts
  Lakebase branch: feat-add-charts
  Database:        projects/appkit-lakebase-db/branches/feat-add-charts/databases/databricks-postgres
```

The Lakebase branch id is derived from the Git branch name by
[`scripts/branch-name.sh`](scripts/branch-name.sh) (RFC 1123: lowercase,
`[a-z0-9-]`, ≤ 63 chars). The hook and the cleanup Action both call this script,
so local and CI always resolve to the same id — `Fix/BUG-123_edge` →
`fix-bug-123-edge`. The main checkout is not a worktree, so the hook is a no-op
there.

The session receives `AGENT_ENV`, `LAKEBASE_PROJECT_ID`, `LAKEBASE_BRANCH`, and
`LAKEBASE_BRANCH_RESOURCE` (secrets are not exported). Each branch carries a
30-day TTL so an abandoned worktree is reclaimed even if a PR is never opened.

## Database changes

Schema changes are migration files (`node-pg-migrate`, run via `npm run
migrate`) committed alongside the code. Apply and test them only against the
worktree's Lakebase branch — never against `production` by hand.

Production stays current automatically. When migrations merge to `main`, the
**Migrate Lakebase Production** workflow
([`lakebase-migrate-prod.yml`](.github/workflows/lakebase-migrate-prod.yml))
runs `npm run migrate` against `production`. This matters because every preview
branch is a clone of `production`: a merged schema change that never reached
`production` would be missing from every future preview.

## The preview and cleanup automation

Opening or pushing to a PR triggers **Deploy Lakebase Preview**
([`lakebase-preview.yml`](.github/workflows/lakebase-preview.yml)). For PR
`123` it clones `production` into a fresh `pr-123` branch, applies the PR's
migrations to it, deploys the `preview` bundle target (see
[`databricks.yml`](databricks.yml)) as `appkit-lakebase-pr-123` from the PR's
head branch, grants the app access to the schema (below), and comments the
preview URL on the PR. Each PR gets its own bundle state (`root_path` keyed by
PR number) so concurrent previews don't contend on one deploy lock.

Closing or merging the PR triggers **Cleanup Lakebase Branch**
([`lakebase-cleanup.yml`](.github/workflows/lakebase-cleanup.yml)), which
destroys the preview app and its bundle state, deletes both the `pr-123` and the
worktree Lakebase branch, and deletes the Git head branch. (It deletes the Git
branch itself rather than relying on GitHub's native setting, which only fires
on merge, not on close.)

Because a `pull_request` workflow runs the version of itself on the PR's head
branch, changes to these workflows only take effect for PRs branched after the
change reaches `main`.

## One-time setup for the pipeline

The workflows run unattended as a **Databricks service principal (SP)** over
OAuth M2M. Set this up once.

**1. Create the CI service principal** and generate an OAuth secret (client id +
secret) — the identity every preview/cleanup run acts as.

**2. Grant it the `workspace-access` entitlement** (Settings → Identity and
access → Service principals → Entitlements). Without it, Lakebase API calls
fail with *"This API is disabled for users without the workspace-access
entitlement."*

**3. Give it `CAN_MANAGE` on the Lakebase project** so it can create and delete
branches:

```bash
databricks permissions update database-projects appkit-lakebase-db --json '{
  "access_control_list": [
    { "service_principal_name": "<CI_SP_CLIENT_ID>", "permission_level": "CAN_MANAGE" }
  ]
}'
```

**4. Configure the GitHub Actions variables and secret** (repo or org level):

| Kind     | Name                       | Value                            |
| -------- | -------------------------- | -------------------------------- |
| Variable | `DATABRICKS_HOST`          | Workspace URL                    |
| Variable | `DATABRICKS_CLIENT_ID`     | CI SP client id                  |
| Variable | `LAKEBASE_PROJECT_ID`      | e.g. `appkit-lakebase-db`        |
| Secret   | `DATABRICKS_CLIENT_SECRET` | CI SP OAuth secret               |

The migrate and grant steps resolve the Postgres host, endpoint, and database
from the branch at runtime, so no `PGHOST` variable is needed.

**5. Set up the `app_schema_owner` role** so preview apps can own their schema.
This is the subtle part. Each Databricks App runs as its *own* auto-created SP,
and each preview app doesn't just read and write the `app`/`appkit` schemas — it
*evolves* them at startup (`CREATE TABLE` / `ALTER TABLE … ADD COLUMN` in
[`todo-routes.ts`](server/routes/lakebase/todo-routes.ts)), which requires
ownership. Lakebase has no true superuser, so ownership can't be handed to each
ephemeral app SP directly. Instead, a shared role owns the schemas and each app
SP is made a member.

Once, on the `production` branch (as the schema owner, in the SQL editor), make
the role own the schemas — clones then inherit these owners:

```sql
CREATE ROLE app_schema_owner;
GRANT app_schema_owner TO current_user;      -- so you can reassign to it
ALTER SCHEMA app       OWNER TO app_schema_owner;
ALTER TABLE  app.todos OWNER TO app_schema_owner;
ALTER SCHEMA appkit    OWNER TO app_schema_owner;
-- reassign any other tables/sequences in these schemas to the role too
```

Then add the CI SP to the role **with admin option**, so it can grant membership
to each preview app SP in CI:

```sql
GRANT app_schema_owner TO "<CI_SP_CLIENT_ID>" WITH ADMIN OPTION;
```

`WITH ADMIN OPTION` is a *Postgres* grant and is **not** the same as any
Databricks permission — Databricks "Admin"/"Can Manage" is control-plane and
does nothing inside Postgres. Only a role holding the in-database admin option
on `app_schema_owner` may grant it; without it the per-PR grant fails with
*`Only roles with the ADMIN option on role "app_schema_owner" may grant this
role.`* Because memberships are captured at clone time, granting on `production`
covers future clones; a branch cloned earlier needs the grant re-run on it (or a
close/reopen to re-clone).

Per PR this is automated: the preview workflow reads the new app's SP and runs
`GRANT app_schema_owner TO "<preview_app_sp>";` as the CI SP, so the app — now a
member of the owning role, with `INHERIT` — can run its startup DDL and its
reads and writes. Migrations keep the schema *current*; this role is what lets
the app *own* it.

## Running locally

```bash
npm install       # after changing deps, run `npm run lockfile:fix` (below)
npm run dev       # hot-reload dev server
npm run build     # client + server production build
npm start         # run the production build
```

Quality gates: `npm run typecheck`, `npm run lint` (`:fix`), `npm run format`
(`:fix`).

Lakebase connectivity needs the environment described in the
[Lakebase plugin docs](https://developers.databricks.com/docs/appkit/v0/plugins/lakebase);
copy `.env.example` to `.env` to configure it. The CLI deploys via Databricks
Asset Bundles (`databricks bundle deploy` / `databricks apps deploy`); the
`default` target is production and `preview` is the per-PR target driven by CI.

> **Dependency changes:** installing through the internal
> `npm-proxy.dev.databricks.com` mirror bakes that host into
> `package-lock.json`, which GitHub-hosted CI cannot reach. Run
> `npm run lockfile:fix` after changing dependencies and commit the result; CI
> fast-fails if an internal-proxy URL slips through.

## Guardrails

Work only on the branch and Lakebase branch assigned to the worktree; never
switch branches. Never connect to or modify the `production` Lakebase branch,
never use production database credentials, and never create or delete Databricks
Apps or Lakebase branches by hand — the workflows own that.

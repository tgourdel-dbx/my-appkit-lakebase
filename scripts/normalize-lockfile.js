// Keeps package-lock.json portable across registries.
//
// The lockfile pins canonical PUBLIC-registry tarball URLs
// (registry.npmjs.org). Each environment then fetches them through its own
// configured registry: CI (GitHub-hosted) hits registry.npmjs.org directly,
// while developers behind the internal npm proxy have the host rewritten to
// the proxy at fetch time by `replace-registry-host=npmjs` (see .npmrc).
//
// The problem this guards against: when a developer whose active registry is
// the internal proxy adds/updates a dependency, npm records the *proxy* host
// in the new lockfile entries. GitHub-hosted CI can't reach that internal host
// and the install times out. This script rewrites any such internal-proxy host
// back to the public registry so the committed lockfile stays portable.
//
// Integrity hashes are content-based (sha512 of the tarball) and the proxy
// mirrors the same tarballs, so only the host changes — the lockfile stays
// valid.
//
// Usage:
//   node scripts/normalize-lockfile.js          # rewrite in place
//   node scripts/normalize-lockfile.js --check   # exit 1 if a rewrite is needed

import { readFileSync, writeFileSync } from 'node:fs';

const INTERNAL_HOST = 'npm-proxy.dev.databricks.com';
const PUBLIC_HOST = 'registry.npmjs.org';
const LOCKFILE = 'package-lock.json';
const check = process.argv.includes('--check');

const original = readFileSync(LOCKFILE, 'utf8');
const matches = original.match(new RegExp(INTERNAL_HOST.replace(/\./g, '\\.'), 'g'));
const count = matches ? matches.length : 0;

if (count === 0) {
  console.log(`[lockfile] OK — no ${INTERNAL_HOST} URLs in ${LOCKFILE}.`);
  process.exit(0);
}

if (check) {
  console.error(
    `[lockfile] ${count} internal-proxy URL(s) (${INTERNAL_HOST}) found in ${LOCKFILE}.\n` +
      `GitHub-hosted CI cannot reach that host, so installs will time out.\n` +
      `Fix it with: npm run lockfile:fix`
  );
  process.exit(1);
}

const rewritten = original.replaceAll(
  `https://${INTERNAL_HOST}/`,
  `https://${PUBLIC_HOST}/`
);
writeFileSync(LOCKFILE, rewritten);
console.log(`[lockfile] Rewrote ${count} ${INTERNAL_HOST} URL(s) to ${PUBLIC_HOST} in ${LOCKFILE}.`);

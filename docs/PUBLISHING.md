# Publishing Guide

Releases are manually triggered via the `Release` GitHub Actions workflow. Pushing to `main` does NOT publish.

## Trigger a release

UI: GitHub repo -> Actions -> Release -> Run workflow. Pick `version_type` (patch / minor / major). Optionally enable `dry_run` to validate the pipeline without publishing.

CLI:

```bash
# Standard release
gh workflow run release.yml -f version_type=patch

# Dry run: validates prepare + build + AI release notes generation.
# Creates a transient release branch, runs the build, generates the
# bilingual release notes (uploaded as a job artifact and rendered to
# the run summary), then deletes the branch.
# Does NOT merge to main, tag, publish to npm, or create a GitHub release.
gh workflow run release.yml -f version_type=patch -f dry_run=true
```

Pick `version_type` per the Versioning Policy in `AGENTS.md` — typically `patch` for fix-only commits, `minor` for a native SDK minor bump or a new JS feature, `major` for breaking changes.

## What the workflow does

1. **prepare** — computes the next version from `package.json` + `version_type`, creates a `release/v<x.y.z>` branch, runs `npm version` + `pnpm install --lockfile-only`, commits as `chore(release): v<x.y.z> [skip ci]`, pushes the branch.
2. **build** — `pnpm build` on the release branch.
3. **release-notes** — generates bilingual EN/KR release notes via [`asleep-ai/actions/release-notes`](https://github.com/asleep-ai/actions) using the commit range since the previous tag. Uploads the markdown as a `release-notes` artifact and renders a preview in the run summary. Runs in both dry-run and real-release paths so the prompt and `OPENAI_API_KEY` wiring are validated before any real publish. Falls back to a plain commit list if `OPENAI_API_KEY` is missing or OpenAI errors.
4. **merge** — opens a PR titled `chore(release): v<x.y.z>` and auto-merges it to `main`, deleting the release branch. Waits on `release-notes` so the branch outlives the notes generation.
5. **publish-npm** — checks out main, builds, runs `npm publish --provenance --access public`. Authentication is via OIDC (`id-token: write`); no `NPM_TOKEN` secret is used.
6. **release-github** — tags `v<x.y.z>` on the merge commit, downloads the `release-notes` artifact, and creates a GitHub release with `gh release create --notes-file release-notes.md`.
7. **cleanup** — runs after a dry run (deleting the transient release branch) or on failure of any real-release job (so the next attempt starts fresh). A successful real release reaches this with the branch already gone, so the delete is a no-op.

## Prerequisites

- The npm package must already trust the GitHub repo for OIDC provenance publishing. This was configured when semantic-release first published the package; no action needed for routine releases.
- `main` branch protection (if any) must allow GitHub Actions to merge PRs. If not, the `merge` job will fail and you'll need to either relax protection or supply a PAT via a repo secret.

## Do not

- Do not run `npm publish` manually.
- Do not bump the version in `package.json` by hand — the workflow does it on the release branch.
- Do not push tags manually — the workflow tags `main` after merge.

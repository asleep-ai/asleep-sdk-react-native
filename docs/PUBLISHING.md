# Publishing Guide

This package uses [semantic-release](https://semantic-release.gitbook.io/) for automated version management and package publishing.

## Automated Release Process

Releases are triggered automatically via GitHub Actions when changes are pushed to the `main` branch:

1. Push changes to `main` branch
2. GitHub Actions runs the Release workflow
3. semantic-release analyzes commits and determines version bump
4. Automatically publishes to npm if needed

## Manual Release

To trigger a release manually:

```bash
# From GitHub UI
# Go to Actions → Release → Run workflow

# Or using GitHub CLI
gh workflow run release.yml --ref main
```

## Important Notes

- **DO NOT** add a custom `publish` script to package.json
- **DO NOT** run `npm publish` manually
- All releases must go through semantic-release to maintain version consistency

## Configuration

- Release configuration: `.releaserc.js`
- Publish settings: `package.json` → `publishConfig`
- Workflow: `.github/workflows/release.yml`
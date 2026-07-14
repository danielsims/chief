# Chief web

The public website, pricing and download pages, authentication flow, billing return flow, and desktop sign-in bridge.

## Run locally

```bash
pnpm --filter @chief/web dev
```

Open `http://localhost:3000`.

## Configuration

Copy the sanitized example:

```bash
cp apps/web/.env.example apps/web/.env.local
```

The download URLs are optional. Without them, the download page shows the early-access action.

The desktop updater reads signed release artifacts from GitHub through
`/api/update`. Public releases need no GitHub credentials. While the repository
is private, or to raise the GitHub API rate limit, set `GITHUB_TOKEN` to a
fine-grained token with read-only access to repository contents.

## Build

```bash
pnpm --filter @chief/web build
```

# Contributing to Chief

Thanks for taking the time to improve Chief.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Use an issue to discuss substantial product or architecture changes first.
- Never include credentials, customer data, local runtime state, or generated
  build output.

## Run Chief locally

Install the prerequisites and dependencies described in the
[README](./README.md), then start the services in separate terminals:

```bash
pnpm relay:dev
pnpm dev
pnpm desktop
```

Desktop and mobile clients default to Chief's hosted relay and sign-in service
unless you select another relay or configure URL overrides. The web app also
defaults to the hosted relay. Starting local services does not automatically
point clients at them.

For local desktop development, copy `apps/desktop/.env.example` to
`apps/desktop/.env.local` and set `VITE_CHIEF_RELAY_URL`, `VITE_AUTH_BASE_URL`,
and `VITE_AUTH_UI_URL` for your relay and authentication UI. Copy
`apps/web/.env.example` to `apps/web/.env.local` and set `CHIEF_RELAY_URL` to
your relay. See the [desktop configuration guide](./apps/desktop/README.md#configuration)
and [self-hosting guide](./deploy/self-host/README.md) for setup details.

## Make a change

- Keep pull requests focused on one problem.
- Follow the existing code and interface conventions.
- Add or update tests when behavior changes.
- Update documentation when setup or public behavior changes.
- You are responsible for understanding and reviewing any AI-assisted code you
  submit.

Run the relevant checks before opening a pull request:

```bash
pnpm typecheck
pnpm build
```

If a repository-wide check is unrelated to your change or cannot run locally,
say so clearly in the pull request.

## Open a pull request

Explain the problem, the chosen solution, and how you verified it. Include
screenshots or recordings for visible interface changes.

By contributing, you agree that your contribution is licensed under the
repository's [GNU Affero General Public License version 3](./LICENSE).

Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md) in every project
space.

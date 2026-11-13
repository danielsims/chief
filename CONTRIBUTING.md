# Contributing to Chief

Thanks for taking the time to improve Chief.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Use an issue to discuss substantial product or architecture changes first.
- Never include credentials, customer data, local runtime state, or generated
  build output.

## Run Chief locally

Install the prerequisites and dependencies described in the
[README](./README.md), start Docker Desktop, then run:

```bash
pnpm dev
```

This uses the existing self-hosted Docker stack and the normal Tauri desktop
app. Local migrations run automatically and local accounts/workspaces are
retained. The default gateway and sign-in UI are `http://localhost:8080`.
If the app previously selected another relay, choose **Connect a self-hosted
relay** in Chief and enter that URL. No production deployment is involved.

Ctrl+C stops the desktop. `pnpm self-host:down` stops the Docker services
without deleting their data. The existing `pnpm desktop:dev` alias starts the
same loop. For individual service work, use the package's own dev command or
`pnpm relay:dev`.

See the [desktop configuration guide](./apps/desktop/README.md#configuration)
and [self-hosting guide](./deploy/self-host/README.md) for other relay URLs and
manual service management.

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

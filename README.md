<p align="center">
  <a href="https://heychief.sh">
    <img src="./.github/assets/chief-readme-hero.png" alt="Chief" width="1280" />
  </a>
</p>

# Chief

Chief is a workspace for building, running, and supervising proactive AI agents. It combines agent instructions, tools, playbooks, schedules, conversations, and action items in a local-first desktop app.

Chief is in early preview. The current product is focused on marketing teams, with desktop apps for macOS and Windows.

## What Chief does

- Runs specialist agents for strategy, content, analytics, prospecting, advertising, and integration setup.
- Turns reusable playbooks into work that can run now or on a schedule.
- Executes scheduled work in private sessions while keeping conversations focused on decisions and useful outcomes.
- Produces reviewable results with structured artifacts such as charts, tables, drafts, and action items.
- Connects agents to approved tools while keeping publishing, outreach, and spend behind explicit approval rules.
- Runs the agent runtime locally and packages it with the desktop app.

## The team

| Agent                   | Responsibility                                                        |
| ----------------------- | --------------------------------------------------------------------- |
| Chief Marketing Officer | Sets direction, delegates work, and keeps the team aligned.           |
| Setup                   | Connects services and resolves missing prerequisites.                 |
| Content Writer          | Creates channel-native drafts grounded in brand context and evidence. |
| Analyst                 | Reviews acquisition, product, funnel, and content performance.        |
| Prospector              | Finds timely prospects, conversations, and research opportunities.    |
| Ads Manager             | Reviews paid acquisition and proposes changes for approval.           |

Agents can use focused playbooks such as growth reports, founder content, buying-signal research, conversion reviews, campaign monitoring, search opportunities, and social account setup.

## Repository structure

| Path                                                           | Purpose                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`apps/desktop`](./apps/desktop/README.md)                     | Tauri desktop app and React interface.                                |
| [`apps/web`](./apps/web/README.md)                             | Marketing site, authentication, billing, and desktop auth bridge.     |
| [`apps/workspace`](./apps/workspace/README.md)                 | Eve workspace used to build and run deployable agents.                |
| [`packages/agent-runtime`](./packages/agent-runtime/README.md) | Local Node runtime, scheduling, tools, channels, and agent execution. |
| [`packages/backend`](./packages/backend/README.md)             | Convex data model, authentication integration, and server functions.  |
| [`packages/email`](./packages/email/README.md)                 | React Email templates and Cloudflare Email Service transport.         |
| [`packages/ui`](./packages/ui/README.md)                       | Shared components, typography, and design tokens.                     |

## Local development

### Prerequisites

- macOS 13 or newer, or Windows 10 or newer, for the desktop app
- Node.js 24 or newer
- pnpm 10.17 or newer
- Rust and the platform dependencies required by Tauri
- A Convex deployment for authentication and shared application data

### Install

```bash
git clone https://github.com/danielsims/chief.git
cd chief
pnpm install
```

Initialize the Convex backend in one terminal:

```bash
pnpm --filter @chief/backend dev
```

Start the web and workspace services:

```bash
pnpm dev
```

Then start the desktop app:

```bash
pnpm desktop
```

The marketing site runs on `http://localhost:3000` and the React Email preview runs on `http://localhost:3001` with `pnpm email`.

## Useful commands

```bash
pnpm typecheck
pnpm build
pnpm --filter @chief/desktop build:app
```

## Release security

The repository contains sanitized development examples only. Official signing certificates, notarization credentials, updater keys, and release configuration are supplied by a private build environment and are never committed. Forks must provide and use their own release identity.

## Contributing

Bug reports, focused fixes, and thoughtful product discussions are welcome. Read
the [contributing guide](./CONTRIBUTING.md) before opening a pull request and
follow the [Code of Conduct](./CODE_OF_CONDUCT.md) in project spaces. Report
security vulnerabilities through the process in [SECURITY.md](./SECURITY.md).

## License

Chief's source code is available under the [GNU Affero General Public License
version 3](./LICENSE). You may run, study, modify, and self-host it under the
terms of that license. Paid Chief plans cover the managed product and hosted
services, not a separate license to the source code.

If you distribute a modified version, or make one available to users over a
network, you must make its corresponding source available under the same
license.

Copyright © 2026 Latent Supply Pty Ltd.

## Website

Learn more and download Chief at [heychief.sh](https://heychief.sh).

<p align="center">
  <a href="https://heychief.sh">
    <img src="./.github/assets/chief-readme-hero.png" alt="Chief" width="1280" />
  </a>
</p>

# Chief

Chief is a local-first workspace where people and proactive AI agents work together across channels, threads, files, schedules, tools, and action items.

Chief is in early preview, with desktop apps for macOS and Windows.

## What Chief does

- Coordinates a team of specialist agents across business, research, marketing, analytics, product engineering, and integration setup.
- Keeps delegated work in shared channels and threads, with detailed activity available when you want to inspect it.
- Turns reusable playbooks into work that can run now or on a schedule.
- Executes scheduled work in private sessions while keeping conversations focused on decisions and useful outcomes.
- Produces reviewable results with structured artifacts such as charts, tables, drafts, and action items.
- Connects agents to approved tools while keeping publishing, outreach, and spend behind explicit approval rules.
- Runs the agent runtime locally and packages it with the desktop app.

## The team

| Agent          | Responsibility                                                                     |
| -------------- | ---------------------------------------------------------------------------------- |
| Chief          | Coordinates the workspace, delegates work, and brings decisions back to you.       |
| Engineer       | Investigates product issues and prepares reviewable implementation changes.        |
| Setup          | Connects services and resolves missing prerequisites.                              |
| Marketer       | Grounds positioning, audience, voice, vocabulary, and claims in evidence.          |
| Content Writer | Creates channel-native drafts grounded in brand context and evidence.              |
| Analyst        | Reviews acquisition, product, funnel, and content performance.                     |
| Prospector     | Finds timely prospects, conversations, buying signals, and research opportunities. |
| Ads Manager    | Reviews paid acquisition and proposes changes for approval.                        |

Agents can use focused playbooks, connected services, and general workspace tools to research, create artifacts, implement changes, and run recurring work. Tool access and consequential actions remain governed by workspace permissions and approval rules.

## Repository structure

| Path                                                           | Purpose                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`apps/desktop`](./apps/desktop/README.md)                     | Tauri desktop app and React interface.                                |
| [`apps/web`](./apps/web/README.md)                             | Marketing site, authentication, and desktop auth bridge.              |
| [`packages/agent-runtime`](./packages/agent-runtime/README.md) | Local Node runtime, scheduling, tools, channels, and agent execution. |
| [`packages/email`](./packages/email/README.md)                 | React Email templates and Cloudflare Email Service transport.         |
| [`packages/ui`](./packages/ui/README.md)                       | Shared components, typography, and design tokens.                     |

## Local development

### Prerequisites

- macOS 13 or newer, or Windows 10 or newer, for the desktop app
- Node.js 24 or newer
- pnpm 10.17 or newer
- Rust and the platform dependencies required by Tauri

### Install

```bash
git clone https://github.com/danielsims/chief.git
cd chief
pnpm install
```

Start the relay in one terminal:

```bash
pnpm relay:dev
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

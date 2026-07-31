# Chief for Buzz

This package is Chief's portable team definition for Buzz. It is independent of
the Chief desktop application and agent runtime, so it can move to its own
repository later without changing its public contract.

The team includes Chief, Setup, Analyst, Content Writer, Prospector, and
Engineering. Chief is the primary orchestrator and configures the workspace:

Every imported agent carries Chief's avatar inline in the team snapshot, so
Buzz displays the Chief brand instead of falling back to a runtime provider
logo. The image has no external hosting dependency.

- `chief-hq` is the open permanent town hall for weekly all-hands reviews,
  decisions, and cross-team coordination.
- `chief-marketing` is open and contains Chief, Analyst, and Content Writer.
- `chief-prospecting` is open and contains Chief and Prospector.
- `chief-engineering` is open and contains Chief and Engineering.
- `chief-setup` is private and contains Chief and Setup.

The installing human is added to every channel. Chief lists channels and
memberships before changing anything, reuses exact matches, creates only
missing channels, and verifies membership before declaring setup complete.
Channel and membership events are performed by Chief so the Buzz activity trail
reads naturally.

Stock Buzz does not currently expose an imported local team record to the
running agent. Chief therefore resolves siblings from the imported members
already present in canonical `chief-hq`, using exact display name, inline Chief
avatar, and same-owner identity. Repeated imports are handled deterministically
inside that canonical boundary, so duplicate profiles do not silently omit
Engineering or Prospector. A profile still syncing never blocks channel
creation or onboarding; Chief starts with the installer and repairs that one
membership when it becomes available.

## Try it in Buzz

Build the portable artifacts:

```sh
pnpm --filter @chief/buzz-team build
```

Buzz currently requires a channel before a team can be added. Create or open
`chief-hq`, then import:

```text
artifacts/chief.team.json
```

Send one top-level kickoff message:

> @Chief Set up Chief for my business.

A team snapshot has no post-import lifecycle hook in stock Buzz, so importing
alone cannot start an unsolicited agent turn. After that one kickoff, Chief
runs the workspace setup, adds the installing human, and opens or reuses an
exact one-to-one DM with the installer for the questionnaire. Buzz automatically
addresses DM participants, so subsequent answers do not need another `@Chief`
mention. `chief-setup` remains the private work channel for integration setup
and authentication handoffs.

## Onboarding

Chief asks one concise question at a time about the company, offer, audience,
90-day goal, brand, prospecting sources, analytics, advertising, engineering
stack, AI referrals, integrations, timezone, and recurring work.

After confirmation, Chief saves a non-secret shared brief to the `chief-hq`
canvas, then starts the selected setup and specialist work with explicit,
idempotent @mentioned kickoff messages in the focused channels. Adding an agent
to a channel alone does not wake it. Chief verifies the actual mention tag and
creates only the approved schedules.

## Workflows

Chief uses Buzz's native workflow engine for recurring work. Scheduled workflow
messages mention the responsible imported agent, which lets Buzz wake that
sibling agent in the correct channel.

Workflow names start with `Chief - `. Chief lists existing workflows before
creating one and updates exact matches instead of duplicating schedules.
Five-field cron schedules are interpreted in UTC, so Chief confirms both the
human's local time and the resulting UTC expression.

An authenticated Chief webhook can be added later for jobs that genuinely need
remote compute, but it is not required for native scheduled agent work and
Chief never invents a webhook endpoint.

## Pulse

Every role can publish meaningful completed work to Buzz Pulse. Pulse is the
executive activity feed, not a tool log: agents publish outcomes, material
changes, decisions, and genuine blockers while leaving routine progress in its
source channel.

Chief uses `chief-hq` for the weekly all-hands and publishes one concise Pulse
summary covering wins, risks, decisions, and next-week priorities.

Pulse notes are community-visible global notes. Agent prompts prohibit copying
secrets, private-channel content, personal data, or sensitive customer details
into Pulse.

## Portable visual reports

Core Chief work uses native Buzz messages and image attachments. An approved
report-rendering tool can render trusted templates—such as Message UI charts—to
PNG and upload the result as an ordinary Buzz attachment. Important values and
conclusions remain in text, so reports are accessible and work in an unmodified
Buzz client.

The enhanced inline browser is optional. Setup uses its custom attachment
protocol whenever the pinned `agent-browser` CLI is available in its execution
environment. It does not depend on a separate host capability flag. Without a
runnable browser stream, Setup uses ordinary Buzz messages, attachments,
provider tools, and official handoff URLs; it does not leak raw browser
protocol messages into chat.

Development hosts inject an absolute `AGENT_BROWSER_CLI` path so managed agents
use the already-installed pinned executable without npm registry access. The
prompt retains the pinned `npx` command only as a portable fallback.

## Enhanced browser

Setup can open a local browser session and publish a trusted
`buzz:browser-session` attachment when the Buzz host supports it.

The enhanced Buzz host renders it with
`@browser-ui/react`, including direct interaction, picture-in-picture, and
fullscreen controls.

Setup reads the live stream port from `agent-browser stream status` before
publishing the attachment. It does not assume a fixed port or close the session
immediately after navigation.

When the source-adapter environment is configured, Setup relays that loopback
stream outbound through the Browser UI gateway and publishes a credential-free
version 2 attachment. Without that environment it falls back to the version 1
desktop-local attachment. Setup still controls `agent-browser` directly in both
cases; Chief does not own or proxy browser commands.

The attachment uses an opaque `session_id`; the private agent-browser process
name is never published or accepted by the Buzz UI as a native command target.
The current loopback adapter is visible only on the computer hosting the
browser. Collaborative channel viewing requires Buzz's authenticated remote
session gateway, where observation and exclusive control are separate grants.

The browser card has an explicit lifecycle. `state: "operating"` blocks human
input while Setup is working, `state: "waiting"` keeps the same session visible
and interactive for a human-only step, and `state: "complete"` collapses it
into a compact result. A later agent turn cannot reactivate a completed browser
from an unrelated conversation.

## Package contents

- `src/team.ts` is the source of truth for the app, team, agents, and tool
  profiles.
- `artifacts/chief.team.json` is Buzz's native importable team snapshot.
- `artifacts/chief.app.json` is directory metadata for the future
  “Add Chief to Buzz” flow.

## Tool boundaries

Every role has a dedicated Executor Toolkit identifier. Shared Buzz
conversation, artifact, and Pulse capabilities remain host facilities rather
than being duplicated in every toolkit.

Setup maps to the `chief-setup` Executor Toolkit. The current Buzz snapshot
format does not carry machine-local MCP configuration, so the runnable path
uses the pinned `agent-browser` CLI through Codex's shell. Buzz trusts the
resulting browser attachment because the message is signed by the managed
agent, not because Chief publishes or brokers the browser session.

No credentials, machine paths, workspace identifiers, or Executor bearer
tokens are stored in either artifact.

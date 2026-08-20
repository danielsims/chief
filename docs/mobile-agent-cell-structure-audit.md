# Mobile agent cell structure audit

This documents the implementation after the first eve-alignment pass. It is
the current code, not a claim that celld can execute the upstream Node runtime.
Chief now installs a filesystem-authored package manifest into every agent
cell and gives each conversation a fixed durable session, cursor and recoverable
turn checkpoint. The remaining gap is compilation of `agent.ts` and portable
package declarations for native tools, channels, connections and sandboxes.

## Runtime hierarchy today

```text
Chief iOS process
├── one embedded Celld engine
│   └── one keyed cell per agent (never one cell shared by agents)
│       ├── cell key: <workspace-id>:<agent-id>
│       ├── isolated Celld/SQLite object storage
│       │   ├── eve:package:manifest
│       │   ├── eve:package:instructions
│       │   └── conversation:<channel-id>:
│       │       ├── session { fixed sessionId, streamIndex, status }
│       │       ├── messages { immutable completed history }
│       │       ├── pendingTurn
│       │       ├── activeTurn { streamed reasoning + tool step checkpoints }
│       │       └── browser release/end receipts
│       ├── one Nostr secp256k1 identity
│       │   └── Keychain account: <workspace-id>:<agent-id>
│       ├── canonical authored package
│       │   ├── agents/<agent-id>/instructions.md   [required + loaded]
│       │   ├── agents/<agent-id>/agent.ts          [required + recorded]
│       │   └── agents/<agent-id>/skills/*/SKILL.md [discovered + on-demand]
│       ├── Swift host capabilities, filtered per turn and policy
│       │   ├── relay channel/message tools
│       │   ├── workspace data tools
│       │   └── isolated native browser tools
│       └── browser scope: <workspace-id>:<agent-id>:<conversation-id>
└── relay
    ├── registered agent_keys row per agent public key
    ├── mailbox/job Durable Object: <workspace-id>:<agent-id>
    └── workspace/channel authorization evaluated for that agent principal
```

One Celld engine hosts many named Durable Object cells inside the iOS process,
but an agent never shares a cell with another agent. Each cell has its own
keyed SQLite object storage and each agent has a separate Keychain identity.
Conversations are namespaces inside that agent's cell, not agent runtimes.
Every conversation permanently owns one session ID. Reconnect/resume advances
the stored stream cursor; it does not silently switch to a replacement session.
During a turn, reasoning and each tool start/result are atomically replaced in
`activeTurn`. After an interruption the worker materializes those checkpoints
in chronological order, seeds completed-tool evidence into the resumed model
turn, and only reruns unfinished work. Relay mutations still carry idempotency
keys as the final defense against duplicate side effects.

## Canonical agent packages currently shipped

```text
packages/agent-runtime/src/agents/
├── chief/
│   ├── agent.ts
│   └── instructions.md
├── brand/
│   ├── agent.ts
│   ├── instructions.md
│   └── skills/build-brand-profile/SKILL.md
├── prospector/
│   ├── agent.ts
│   ├── instructions.md
│   └── skills/find-buying-signals/SKILL.md
├── engineer/
│   ├── agent.ts
│   └── instructions.md
├── setup/...
├── analyst/...
├── content/...
├── ads/...
├── loader.ts
└── manifest.ts
```

Open the package files:

- Chief: [manifest](../packages/agent-runtime/src/agents/chief/agent.ts), [instructions](../packages/agent-runtime/src/agents/chief/instructions.md)
- Marketer: [manifest](../packages/agent-runtime/src/agents/brand/agent.ts), [instructions](../packages/agent-runtime/src/agents/brand/instructions.md), [brand-profile skill](../packages/agent-runtime/src/agents/brand/skills/build-brand-profile/SKILL.md)
- Prospector: [manifest](../packages/agent-runtime/src/agents/prospector/agent.ts), [instructions](../packages/agent-runtime/src/agents/prospector/instructions.md), [buying-signals skill](../packages/agent-runtime/src/agents/prospector/skills/find-buying-signals/SKILL.md)
- Engineer: [manifest](../packages/agent-runtime/src/agents/engineer/agent.ts), [instructions](../packages/agent-runtime/src/agents/engineer/instructions.md)
- Package composition: [manifest registry](../packages/agent-runtime/src/agents/manifest.ts), [filesystem loader](../packages/agent-runtime/src/agents/loader.ts)

Open the mobile runtime wiring:

- [Cell runtime and keyed scope](../apps/mobile/Chief/Vendored/CelldKit/ChiefCellRuntime.swift)
- [Durable worker stored inside each cell](../apps/mobile/Chief/Resources/agent.js)
- [Worker session/checkpoint support](../apps/mobile/Chief/Resources/agent-support.js)
- [Durable turn checkpoint and workflow-world port](../apps/mobile/Chief/Core/AgentTurnCheckpoint.swift)
- [Canonical package bundle loader](../apps/mobile/Chief/Core/AgentPackageBundle.swift)
- [Skill bundle loader](../apps/mobile/Chief/Core/AgentSkillBundle.swift)
- [Inference, reasoning stream, and native tool host](../apps/mobile/Chief/Vendored/CelldKit/ChiefOpenCodeAgentHost.swift)
- [Per-agent Keychain identity](../apps/mobile/Chief/Core/AgentIdentityStore.swift)
- [Per-agent mailbox loop](../apps/mobile/Chief/Core/WorkspaceAgentLoop.swift)
- [Per-agent and per-conversation browser scope](../apps/mobile/Chief/Core/AgentBrowserSession.swift)
- [Relay-native tool definitions](../apps/mobile/Chief/Core/RelayAPITools.swift)
- [Native browser tool definitions](../apps/mobile/Chief/Core/AgentBrowserTools.swift)

## Eve comparison

| Eve project element | Current Chief mobile state |
| --- | --- |
| `instructions.md` | Yes. The exact canonical file is now bundled and injected into that agent's system prompt. |
| `agent.ts` | Partial. It is now required and its location is recorded in the cell's installed package manifest, but Swift does not execute or compile its TypeScript exports yet. |
| `tools/*.ts` | No. Native host bindings are shared Swift types, then constrained by agent config and per-turn allowlists. |
| `skills/*` | Partial. Canonical skill directories are discovered during package installation and their Markdown is loaded only when explicitly attached. |
| `subagents/*` | No package subtree. Chief delegates to peer agents in their own cells through relay messages/jobs, rather than nesting another agent inside Chief's cell. |
| `channels/*` | No package subtree. Relay channel tools are shared native bindings. |
| `connections/*` | No package subtree yet. Selected apps are context only and never treated as proof of a connection. |
| durable sessions | Yes at the celld level. Each conversation has a fixed session ID, stream cursor and explicit running/waiting/failed state. |
| durable steps/replay | Yes for streamed reasoning and tool calls. Completed tool evidence is checkpointed and replayed; unfinished work remains retryable. |
| workflow world | A small `AgentWorkflowWorld` port now exists with a `CelldWorkflowWorld` implementation. It mirrors the boundary, but is not binary/API-compatible with the Node `@workflow/world` protocol. |
| `sandbox/*` | Partial. The trusted Swift host keeps credentials and network authority; each agent/conversation gets isolated browser state. A portable authored sandbox declaration and general filesystem backend are not implemented. |
| `instrumentation.ts` | No package-local instrumentation file. Structured mobile logs and Activity components are emitted by the Swift host. |

## Honest verdict

The runtime now enforces the important principle: **one agent equals one
cell**, one Keychain identity, one relay principal, one mailbox and independent
durable sessions. It also follows eve's core trust boundary: inference secrets
stay in the trusted Swift host and are never placed in the worker, prompt,
sandbox or relay message plane.

It is still not literally the upstream eve runtime. Upstream eve currently
requires Node.js and its extensibility points are a Workflow World package and
a `SandboxBackend`; celld on iOS is neither implementation today. Calling it
fully compatible would be dishonest. The portable end state remains:

```text
agents/<agent-id>/
└── agent/
    ├── instructions.md
    ├── agent.ts
    ├── tools/
    ├── skills/
    ├── subagents/
    ├── channels/
    ├── connections/
    ├── sandbox/
    └── instrumentation.ts
```

Native iOS implementations can remain Swift, but the portable package should
declare the required tool/capability contract and the host should resolve those
declarations. That removes the remaining duplicated roster/config truth from
Swift without weakening iOS sandboxing. A future adapter can then implement the
upstream workflow and sandbox protocols for hosted celld, while the phone keeps
the same package, session and event contracts.

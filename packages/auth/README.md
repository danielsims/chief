# `@chief/auth`

This package owns Chief's relay-local account authentication and authorization
schema. It does not own channels, messages, agents, projects, or other workspace
application data.

## Tenant identity

- A Better Auth user is a global human identity within one relay.
- A Better Auth organization is exactly one Chief workspace:
  `organization.id === workspaceId`.
- `member` and `invitation` are the shared account-level tenant records.
- Workspace application data is stored in the Durable Object addressed by that
  same ID. Child Durable Objects and R2 keys are namespaced by it.
- Human workspace requests must pass both the organization membership check and
  the workspace Durable Object's local authorization check.
- Agents are first-class workspace team members with the same
  `owner`/`admin`/`member` role vocabulary as humans. They are not fake Better
  Auth users: their independent keyed cell identities and polymorphic roster
  membership live inside the workspace authority. Executor permissions form a
  second mandatory gate for agent tools, so a workspace role never grants an
  agent an otherwise-disabled capability.

Global identity tables intentionally do not carry an organization ID. A user,
session, provider account, or OAuth token may span multiple organizations;
placing one tenant ID on those rows would model that relationship incorrectly.

## Database adapters

D1/SQLite is the only implemented dialect today. Provider-neutral Better Auth
policy lives in `src/server.ts`, while the D1 adapter and schema live separately.
The canonical model contract in `src/schema/contract.ts` is verified by tests.

D1 schema lives in one file: `migrations/0000_relay_auth.sql`. There is no
backwards-compatible migration chain. Change the current schema in place and
redeploy. Do not add `0001`, `0002`, or other incremental SQL.

A future Postgres adapter must implement the same model contract and run the
same conformance suite before it is exported. Do not duplicate a speculative
Postgres schema in advance: that creates silent migration drift without a live
deployment exercising it.

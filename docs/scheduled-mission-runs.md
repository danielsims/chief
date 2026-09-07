# Scheduled mission runs

Daniel's requested scope: build the production implementation now, borrowing Buzz's channel-scoped triggers and execution traces. Chief's product is AI coworkers making real progress together, not a generic workflow builder. Keep the calendar and restrained UI. Leave changes uncommitted for review.

## Run model

A schedule is a reusable brief: channel/mission, lead, collaborators, expected result, instructions, constraints and a time budget. Cron, a one-off date, Run now and a signed webhook all create the same durable run. Snapshot the approved brief when a run is accepted so edits cannot silently change work already underway.

For a team run, the lead first plans the work in the mission channel, collaborators contribute in the same thread, and the lead synthesizes the result with evidence and outstanding blockers. A solo run uses one execution. Persist every phase before dispatch. Agent jobs have deterministic identities so relay retries cannot duplicate accepted work. Completion means the run finished, not that a business metric necessarily improved.

Runs are queued, running, blocked, completed, failed or cancelled. Only one run per schedule executes at once; additional accepted deliveries queue within a bounded limit. Deadlines and paused/stopped missions prevent subsequent phases. Failed work retains its history and can be deliberately retried as a linked new run. Stopping prevents new handoffs and invalidates pending jobs; it cannot undo external effects already performed.

The calendar remains the schedule view. Event details show the brief, team, trigger and recent runs with links to their channel thread. Create/edit is a real form. Settings → Webhooks manages endpoints and their linked schedules. No ordinary DM history appears as schedule content.

## API

Authenticated workspace APIs use the existing relay identity and administrator checks:

- `GET/POST /v1/workspaces/:workspaceId/schedules`
- `POST /v1/workspaces/:workspaceId/schedules/:scheduleId/actions`
- `GET /v1/workspaces/:workspaceId/schedules/:scheduleId/runs`
- `POST /v1/workspaces/:workspaceId/schedules/:scheduleId/runs/:runId/actions`
- `GET/POST /v1/workspaces/:workspaceId/webhooks`
- `POST /v1/workspaces/:workspaceId/webhooks/:webhookId/actions`
- `POST /v1/workspaces/:workspaceId/webhooks/:webhookId/deliveries` is signed by the caller, not by a logged-in Chief user.

Webhook delivery uses `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature` (`v1,<base64 HMAC-SHA256>`). Sign the exact UTF-8 string `id.timestamp.body`. A 32-byte secret is returned only on creation/rotation. Timestamp tolerance is five minutes. Verify before processing. A delivery ID is idempotent; reusing it with another body is a conflict. JSON bodies are bounded to 64 KiB and treated as external context, never as authorization to change the team, tools or constraints. Return 202 with a stable run ID; retries return the original receipt. Rotation revokes the old secret immediately. Disabled endpoints and paused/unapproved schedules do not launch work.

## Verification and delivery

Focus tests on durable replay, partial fan-out, overlap, permission revocation, webhook signature/replay/body limits and actual run outcomes. Use types and actual browser review for ordinary UI. Verify the packaged Codex adapter starts without a global npm or Node installation, and that its pinned native runtime installs automatically. Deploy the production relay and rebuild the signed DMG at the end, without committing.

## Public API

All management requests use the existing Chief account/device authorization and
workspace membership checks. Only workspace owners/admins can activate schedules,
manage webhook secrets, stop runs or retry them. Agents can propose work and report
their assigned step; they cannot approve their own proposal.

| Method | Workspace-relative path | Result |
| --- | --- | --- |
| GET / POST | `/schedules` | List / save a brief |
| POST | `/schedules/:id/actions` | Approve, pause, resume, run |
| GET | `/schedules/:id/runs` | Latest 100 runs with immutable brief and steps |
| POST | `/schedules/:id/runs/:runId/actions` | Cancel or retry, with UUID commandId |
| GET / POST | `/webhooks` | List / create endpoint |
| POST | `/webhooks/:id/actions` | Enable, disable, rotate, delete |
| POST | `/webhooks/:id/deliveries` | Signed event, 202 with runId and duplicate |
| POST | `/schedule-runs/report` | Assigned agent records evidence or a blocker |

Prefix every path with `/v1/workspaces/:workspaceId`. Encode path IDs. The
webhook delivery endpoint uses HMAC authentication instead of account credentials.
Creation and rotation reveal a secret once; listing never returns it. Rotation
immediately invalidates old signatures. Disabling or deleting revokes intake.

### Sending an event (Node.js)

Use the URL and secret from Settings → Webhooks. Keep them in the sender's secret
store. This example assumes environment variables, never credentials in source.

```js
import { createHmac, randomUUID } from 'node:crypto';

const url = process.env.CHIEF_WEBHOOK_URL;
const secret = process.env.CHIEF_WEBHOOK_SECRET;
const id = randomUUID(); // Persist this ID when retrying the same event.
const body = JSON.stringify({ event: 'campaign.measured', campaign: 'launch', signups: 42 });
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
  .update(`${id}.${timestamp}.${body}`).digest('base64');
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  },
  body,
});
if (!response.ok) throw new Error(`Chief returned ${response.status}`);
console.log(await response.json());
```

JSON bodies are limited to 64 KiB; agent instructions contain at most the first
16,000 characters of event context. Use links/IDs for larger records. Context is
explicitly untrusted and does not grant permissions. Timestamps must be within
five minutes. A retry keeps the same event ID and byte-identical body with a fresh
signature. A valid reused ID with different content returns 409. Endpoint intake
is limited to 60 accepted events per minute and 100 unfinished workspace runs.

A 202 acknowledges durable acceptance, not business completion. Inspect the run
for its outcome. A 401 means signature/timestamp invalid, 409 inactive/conflicting,
413 oversized body, 415 wrong content type and 429 capacity exceeded. Retry 429
or 5xx with exponential backoff and the same event ID.

## Implementation verification, September 5 follow-up

- Calendar editor supports lead, collaborators, mission, brief, outcome, constraints,
  time limit, friendly cron, custom cron, local-time one-off and webhook-only work.
- Team handoffs follow plan → contributions → synthesis. Completion waits for the
  final reply/native job result to be persisted. Reports retain evidence per step.
- Both native and external agent paths participate. External continuation access
  is revoked after stop/deadline. Native queued jobs and leases are revoked, and
  on-device workers stop on stale lease renewal. Already completed external side
  effects cannot be undone by stopping a run.
- Focused Durable Object checks exercise actual queues and channel messages, signed
  webhook integrity/deduplication, approval, timezone skipping and mission pause.
- Browser fixtures reviewed the actual editor, detail/run history and webhook dialog.
- Neither Codex ACP nor the native Codex distribution ships in the DMG. Selecting
  Codex installs pinned, checksum-verified packages in Chief's private runtime cache.
  An isolated download and ACP initialize handshake passed without a model prompt.

## Creating the complete schedule through tools

Desktop, hosted and external relay agents use `recurringWork.propose`; mobile agents use `workspace_schedule_propose` with the same JSON object in its `schedule` argument. The HTTP endpoint is `POST /v1/workspaces/:workspaceId/schedules`.

```json
{
  "id": "weekly-growth-review",
  "title": "Weekly growth review",
  "agentId": "chief",
  "collaborators": ["brand", "content"],
  "instructions": "Review campaign results, choose one experiment and draft the next iteration.",
  "newChannel": {},
  "triggerMode": "cron",
  "cron": "0 9 * * 1",
  "timezone": "Australia/Brisbane"
}
```

`newChannel: {}` creates a named mission channel and adds the team. Agents can provide `newChannel.name` and `newChannel.inviteUserIds` when they want to name the channel and invite workspace users explicitly. A human creating the schedule joins automatically. The lead receives channel management rights in a newly created channel. Omit `newChannel` and supply `conversationId` to use an existing channel. Channel creation, memberships, mission creation and schedule saving are one transaction; validation failures roll everything back and identical retries reuse the setup.

For one-time work, provide `onceAt` as an ISO timestamp or Unix milliseconds. For a webhook trigger, set `triggerMode: "webhook"`; cron is then unused. All form options are available: collaborators, existing missionId, expectedOutcome, constraints, maxDurationMinutes, skipDates, approvalSummary and proposedToolPatterns. Existing missions are configured through mission tools and referenced by ID. Use the same schedule ID when revising a proposal.

Agents need `workspace.write` to propose schedules, `channels.create` to create a channel and `members.manage` to add participants. Existing-channel additions also require channel management rights. Personal-agent messaging restrictions still apply. Proposals require owner/admin approval before execution; this does not grant agents permission to approve themselves or manage webhook secrets. Signed webhook URLs are configured through Settings → Webhooks and the existing webhook administration API after review.

Calendar clients may request `GET /v1/workspaces/:workspaceId/schedules?from=<epoch-ms>&to=<epoch-ms>` for a range of up to 93 days. Each visible schedule includes `recordedRuns`, the distinct occurrence timestamps recorded in that range. The default range covers the preceding 35 days. Clients combine these with `upcomingRuns` so dispatching or completing a run does not erase it from the calendar.

## Eve subagent delivery

A declared child of an Eve agent uses its parent's external runtime. The relay
addresses the delivery to the child and sends it to the parent's connected Eve
endpoint. Chief invokes the matching declared Eve subagent tool; the child's own
session receives workspace tools and posts its output under its own identity in
the run thread. A background task receipt only confirms delegation. It does not
complete the collaborator's run step.

The generated adapter carries delivery context through encrypted channel metadata
and durable session state. Relay callbacks validate the addressed agent,
continuation capability, and accepted root session together. Parent acknowledgements
cannot impersonate the child or complete its work. Child completion and failure
hooks settle the run step. If a background task fails before a child turn starts,
Chief reports that failure using the generated `chief_handoff_failed` tool; the run
timeout remains the final bound on a missing callback.

These changes are emitted by `eveProjectFiles`, including each declared child's
tools and hooks. Existing deployments require regeneration through Chief's update
flow. Preparation reuses the existing connection credentials without changing the
live endpoint; the endpoint switches after the generated deployment succeeds.
This does not require editing a deployed agent repository by hand.

## Adding teammates during a run

The lead can call `missions.addRunCollaborator` with `runId`, `agentId`, and a
concrete `assignment` (`POST /v1/workspaces/:workspaceId/schedule-runs/collaborators`).
The relay atomically appends a tracked contribution and updates the run's team.
The lead finishes its current turn, then the scheduler dispatches the contribution
under the selected agent's identity in the same thread. If the lead was already
producing the final result, its in-flight step keeps its ID and becomes planning;
a new final review follows the added work. Repeating the same assignment does not
queue it twice; conflicting assignments and ended runs are rejected.

Only the run's lead may add teammates. Workspace membership, agent sharing,
availability, channel management, and existing mission team restrictions still
apply. The recurring schedule's team is unchanged. An agent mention alone does
not create an assignment.

## Deliverables and progress

The shared artifact instructions are packaged into Eve's root and child agents.
Production steps save substantial output through `files.write` in the channel,
then present its saved ID through `channels.messages.post` with `artifactIds`.
The existing versioned file store, Canvas list, viewer, and channel tabs provide
the durable home for this output. Chat carries a short update and an artifact
reference rather than the full document. Planning steps remain short plans.

Desktop scheduled-run cards and composer presence use recorded run steps to show
the existing matrix indicator for working agents. Cards reflect collaborators
added during execution. Presence is scoped to loaded channel runs and the open
thread, clears on terminal states or failed refreshes, and refreshes when the
window regains focus.


## Mobile run experience

Mobile renders the same system-authored run announcement as a native card, with
team avatars, current collaborators, thread navigation, and the shared matrix
indicator for agents with running steps. Conversation and thread footers use the
same recorded state, refresh while active, and clear progress on completion or
refresh failure. Long-press a card for step details and administrator stop/retry
actions. Retry commands retain their identity across uncertain network responses.

The channel toolbar opens Canvas, which lists saved channel artifacts. Artifact
cards open the Markdown or isolated HTML viewer. The on-device agent uses
`workspace_file_write` and `relay_message_post` with `artifactIds` in the scheduled
thread; successful scoped post receipts suppress duplicate completion messages.
`missions_addRunCollaborator` and `missions_reportRunStep` expose the same run
operations as the relay tools, subject to existing tool approval policies.

Notification destinations survive launch and workspace hydration, including roots
outside the loaded message page. Read errors stay acknowledged across app launches;
a new failure can still surface, and successful recovery clears stale alerts.

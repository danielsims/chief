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

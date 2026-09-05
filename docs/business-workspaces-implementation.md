# Business workspaces implementation

Owner: Daniel. Branch: `feat/effect-oxlint-refactor`. Started 2026-09-05.

Each workspace represents one business. Chief learns the owner's priorities,
coordinates engineering and marketing, and runs bounded missions whose results
can be inspected. This is greenfield: remove obsolete implementations rather
than maintaining compatibility. Do not delete live accounts or data unless a
specific migration requires it and Daniel approves that deletion.

## Workflow

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame. Capture the baseline and define observable outcomes below.
- [x] Phase B: Design the workflow. Runtime and identity first; independent UI
  work in separate checkouts; integration, security, then production delivery.
- [x] Phase C: Run the loop. Reproduce, change, inspect the real artifact, retain
  fixes that pass. Prefer typechecking, focused critical tests, and browser QA.
- [x] Phase D: Keep the audit trail. Record decisions and evidence as work lands.
- [x] Phase E: Verify and hand back. Deploy the relay, build and verify the signed
  DMG, report what Daniel should test.

The baseline is commit `64d29d68`, 190 files of previously unfinished work.
All 18 workspace typechecks passed; baseline lint failed. The checkpoint hook
was explicitly skipped to preserve the unfinished state, not to call it ready.

## Acceptance checklist

Checked items have implementation and local verification. Live business outcomes,
a real subscription-driven turn, physical push delivery, and native refocus under
normal use remain part of Daniel's testing pass. They are not claimed as verified.

### Runtime and stability

- [ ] A custom on-device agent in a cloud workspace can receive a DM and a channel
  mention, run using its configured Codex subscription, and publish replies to
  the same relay conversations as cloud agents.
- [ ] Tool activity and run failures reach the activity panel, including failures
  before inference starts. Failed turns stop their provider process.
- [ ] Refocusing the app does not recreate a healthy runtime or reset transcript,
  scroll, draft, or activity state. Workspace/account switches still isolate data.
- [ ] Recoverable mailbox failures retry; one failure cannot strand queued work.

### Business intake and mission cells

- [x] Chief treats each workspace as a distinct business and asks a short,
  contextual intake about desired outcomes, priorities, constraints, and authority.
  Existing business context is reused rather than repeatedly requested.
- [ ] Real work receives a feature/campaign channel, clear owner, collaborators,
  outcome, and a durable brief. Handoffs actually invoke the other agent.
- [ ] Engineering missions connect to a repository and produce reviewable changes.
- [ ] Marketing missions propose useful work, produce drafts/assets, and request
  the specific approval needed for publishing or spending.
- [x] Iterative missions record a baseline, metric/source, evaluation window,
  hypothesis, result, and keep/revert decision. Budget and stop conditions bound
  repetition; missing data remains unknown and marketing noise is not a win.
- [x] Recurring execution is explicit and visible in Schedule, with work paused
  or completed when its outcome or limits are reached.

### Notifications and inbox

- [x] Inbox detail renders Markdown using the conversation renderer.
- [x] Inbox previews and desktop/iOS banners display readable plain text, with
  links, headings, emphasis, and code markers removed before truncation.
- [ ] Notifications use the existing native push path with a clear permission
  state and conversation deep link. No Hark dependency or extra user webhook setup.
- [x] Review Hark for useful design ideas; record any later enhancement separately.

### Schedule

- [x] Make running, upcoming, paused, failed, and awaiting-approval work understandable.
- [x] Provide a useful empty state and an obvious way to arrange new work.
- [x] Retain working review/edit/pause/resume/run controls and calendar navigation.
- [x] Verify the page in the browser and with empty/populated data.

### Files and integrations

- [x] Improve browsing, filtering, selection, empty states, and file previews.
- [x] Support images and other media where the existing storage can carry them;
  allow agents to publish usable file artifacts rather than text-only placeholders.
- [x] Keep authorization on file access and validate upload limits/types.
- [x] Evaluate Notion/Google Drive-style connections through the existing plugin
  system. Avoid building duplicate connector infrastructure; document what's
  supported now and what depends on connecting an external service.

### Analytics and private repositories

- [x] Decide how Analytics should appear in the business workflow. Prefer relevant
  channel artifacts and evidence over an unexplained permanent dashboard.
- [ ] Verify private-repository attachment and access from the actual project flow.
  Provide an actionable connection route without embedding tokens in URLs/messages.

### Security and maintenance

- [x] Inspect user/agent/workspace boundaries, file access, secrets, plugins, and
  private-repo credential handling. Fix concrete issues and retain evidence.
- [x] Remove dead helpers and duplicate implementations encountered in the work.
- [x] Revisit the 500-line rule. A 750-line ceiling is acceptable when it keeps a
  coherent module together; do not concatenate unrelated modules to meet a quota.
- [x] Repair baseline lint failures relevant to shipping this branch. Avoid broad
  test proliferation; critical integration checks must exercise real behavior.

### Delivery

- [x] All relevant typechecks, lint, focused critical checks, and UI verification pass.
- [x] Commit coherent units, with no secrets or unrelated generated artifacts.
- [x] Deploy production relay via Wrangler only after implementation is complete.
- [x] Rebuild and verify the signed DMG and packaged local runtime.
- [x] Report artifact path, production version, verified behavior, and remaining
  setup that genuinely requires Daniel's account or a physical iPhone.

## Evidence and decisions

- Installed Program workspace reproduced the empty On Device DM/activity panel.
- Local log showed successful job claims followed by a 401 at `/v1/me/workspace`.
  Agent identities must read their own profile through workspace authorization.
- Initial repair integration check passed real Worker routes and Durable Objects:
  own profile, cross-workspace denial, job claim, activity persistence, final DM reply.
  This does not by itself prove a live Codex inference turn.
- The old refocus path replaced both RelayClient and RelayRuntimeClient. The fix
  preserves transport identity while refreshing the same account/workspace.
- Hark reference: https://github.com/R44VC0RP/hark. Keep native notifications;
  its distinction between stored rich content and a short banner is useful here.
- Iteration reference: https://github.com/karpathy/autoresearch. Adopt explicit
  evaluation and recorded experiments, not unbounded iteration on noisy business metrics.

## Integration notes for testing

- Private repositories: attach an existing checkout, or clone with an existing SSH
  key / Git credential helper. GitHub HTTPS users can run `gh auth login` and
  `gh auth setup-git`. Local agents get a persistent separate worktree. Tokens,
  filesystem paths and browsed content stay on the Mac. Cloud private checkout
  still needs a separately configured provider credential; local connection does
  not imply cloud access.
- Files supports text and media up to 8 MB, with image/audio/video preview and
  downloads for other formats. Drive/Notion-style access uses Plugins; no new
  connector dependency was added. Active HTML/PDF embeds are deliberately absent.
- Analytics is surfaced through mission evidence, experiment history and files in
  channel Canvas. The empty standalone Analytics page was removed.
- Existing external Eve deployments embed their tool code and need regeneration /
  redeployment to receive the expanded tool catalog. New generated agents use the
  updated catalog. Deploying the relay alone does not rewrite a Vercel deployment.
- Common default agents can write workspace files and mission records and propose
  schedules. Saved explicit permission overrides still apply. Schedule activation
  stays with the workspace owner/admin; agent plugin installation goes through
  user-operated cards. Project mutations require the project permission.
- Maintenance was targeted: removed the empty Analytics page, obsolete agent
  lookup, file caches that crossed account scopes, and unnecessary dialog resets.
  The line limit is 750 with existing larger modules still required to shrink.
  This is not a claim that every unused export or old subsystem has been removed.

## Verification so far

- `/tmp/chief-release-critical.log`: 13 real relay / Durable Object / R2 checks,
  including durable reply publication and cancelling a pending stopped mission.
- `/tmp/chief-release-desktop-tests.log`: 11 focused desktop checks passed.
- `/tmp/chief-release-runtime-tests.log`: 7 focused runtime and actual Git checks passed.
- `/tmp/chief-mobile-build.log`: iOS simulator build succeeded.
- Browser: actual Schedule overview and dialogs with fixtures (approval 1→0,
  populated/empty), Files gallery/search/filter/image preview, MissionCard,
  StreamingMarkdown and notification text. A real transport-hook harness retained
  one binding and its draft across five workspace snapshot refreshes; fixture
  source retained in `/tmp/chief-review-artifacts/quality-review.tsx`.
- Independent security review found wrong-thread final replies, turn output loss
  at the 500-event history cap, plugin tool approval bypass and suppression of
  fallback replies after a failed post. All four were repaired.

## Final release checks

- All 18 workspace typechecks pass: `/tmp/chief-release-types-final.log`.
- Lint and the source-size check pass: `/tmp/chief-release-lint-final.log`.
  Five existing large runtime modules retain their shrinking size exceptions.
- Final relay checks pass: `/tmp/chief-release-critical-final.log`,
  `/tmp/chief-release-external.log`, `/tmp/chief-release-external-tools.log`.
  Generated external tool client checks pass: `/tmp/chief-release-eve-client.log`.
- Wrangler dry run succeeds and production D1 has no pending migrations:
  `/tmp/chief-relay-dry-run.log`, `/tmp/chief-production-migrations.log`.
- Independent gpt-5.5 trail review required passing final checks and a commit
  before release. It retained live subscription turns, native refocus, and physical
  APNs delivery as explicit user testing items. Earlier failing check logs are
  superseded by the passing final logs above.

Production relay deployed after the passing integration commit `60006492`.
Wrangler version: `41eb658a-feb9-4010-9111-52907eb121d3`.
`https://relay.heychief.sh/health` returned `{"ok":true,"protocolVersion":1}`.
Logs: `/tmp/chief-production-deploy.log`, `/tmp/chief-production-health.json`.

## Daniel's testing pass

1. Install the new DMG, open Program, and DM the on-device agent. Ask it to read
   a connected repository and report one concrete finding. Confirm the reply and
   tool activity appear, then mention it in a channel and reply in that thread.
2. Leave an unsent draft in a DM, switch away from Chief, and return repeatedly.
   Check the draft, transcript, scroll position, and activity remain stable.
3. Ask Chief to interview you about the business and start one engineering or
   marketing mission. Choose a real outcome, collaborators, a source for its
   metric, an iteration limit, and a deadline. Check the channel's Canvas brief.
4. Approve one proposed recurring mission in Schedule. Pause the mission before
   its next run and confirm no further iteration starts. Inspect experiment
   evidence rather than treating the agent's claimed success as measurement.
5. Open a Markdown inbox message and publish an image into Files. Check the image
   preview and a push banner on a physical iPhone. Mobile source builds locally;
   this delivery does not install a new iOS build on your phone.

Existing Eve agents need their deployment regenerated to get the new embedded
workspace tools. Private Git access in this release uses the Mac's existing Git
credentials; attaching a local repository does not grant cloud agents credentials.

The macOS release build uses Node 24.14.0 from `.nvmrc`; the shell's default
Node 22 build was stopped before packaging and restarted with that version.
The app is Developer ID signed. Tauri skipped Apple notarization because no
notarization credentials were present in the build environment. This is a local
testing DMG, not a notarized public-distribution release.

DMG ready: `apps/desktop/src-tauri/target/release/bundle/dmg/Chief_0.1.0_aarch64.dmg`
(Apple Silicon, 55 MB). SHA-256:
`b500b16c8e92e0f91afe10dd1b9fe71a62f80ff7807b6c0d1737bdf9213cab3c`.
Both the build output and the app mounted read-only from the DMG pass deep strict
code-signature verification and the packaged plugin-host startup check. The
verification mount was detached. Logs: `/tmp/chief-release-dmg.log`,
`/tmp/chief-mounted-signature.log`, `/tmp/chief-mounted-runtime.log`.

## September 5 design corrections

Daniel rejected the added Schedule overview and decorative Files details.
Schedule now opens to a single-month calendar, with week/day views and a compact
list of actual schedules and proposals. Ordinary activity is not schedule data.
Unscheduled drafts are no longer assigned an arbitrary calendar date. Removing
the multi-year scrolling month view also removes the scroll reset when changing
views. Paused schedules remain accessible through Schedules; event details retain
editing, pause/resume and run actions.

The schedule detail dialog uses a smaller layout, tighter corners, flat metadata
rows, and a compact actions menu. It no longer repeats timing or nests cards.
Files document previews sit upright against the bottom edge, without rotation,
type badges, revision labels, or the file-count/upload-limit footer.

Shared prompts now ask for short, warm, candid replies with light, unforced
playfulness and no em dashes. Removed the competing sales-style rule. Generated
Eve agents and subagents receive the shared voice; existing embedded deployments
still need regeneration. A prompt instruction is not a guarantee about every
model response.

All 44 installed pstack skills were disabled at Daniel's request by moving them
out of the active Codex skills folder. Reversible backup and inventory:
`/Users/danielsims/.codex/disabled-skills/pstack-2026-09-05/disabled.json`.
No pstack workflow or required delegated review was used for these corrections.

Browser review exercised actual SchedulePage and FilesLibrary with fixture data,
including irrelevant activity that stayed absent, month/week/month navigation,
file alignment, the schedule detail dialog and its actions menu. Temporary review
source is retained outside the repository in `/tmp/chief-refinement-review`.

Latest delivery for these corrections: commit `718a9d66`, production relay version
`64afa2d8-4d0e-4fb9-881b-43abbf21607c`, with a passing production health check.
The rebuilt DMG at the same path supersedes the earlier package. Its SHA-256 is
`03e6c919ff8d8cc730694170b5bee8f1d3a5c0ac6db617853255b79b9cba7388`.
All 18 typechecks and commit lint/source-size checks passed, along with six
existing prompt and Eve-generation checks. The signed build and the app mounted
from the DMG both passed signature and packaged-runtime startup verification.
Notarization remains unavailable in this build environment.
Evidence: `/tmp/chief-refinement-commit.log`, `/tmp/chief-refinement-prompts.log`,
`/tmp/chief-refinement-deploy.log`, `/tmp/chief-refinement-health.json`,
`/tmp/chief-refinement-dmg.log`, `/tmp/chief-refinement-mounted-runtime.log`.

## Channel and DM navigation error correction

Reproduced the transient top-right error in the installed app's On Device DM.
The relay transport did not implement `closeChat`, so normal view cleanup was
reported as an unsupported command. It now detaches the chat view while retaining
the workspace subscription for background activity. Pending loads are scoped to
each opening; responses and failures from closed or replaced views are ignored.
Intentional turn cancellation no longer becomes a generic agent-failure alert.
Current load failures and actual process failures remain visible.

Eight focused checks pass, including rapid channel/DM reopen with out-of-order
responses, retained background subscription, and genuine failure visibility.
The desktop typecheck passes. This correction changes desktop code only.

Delivered in `5c7f2d0f`; commit checks passed all 18 workspace typechecks and
lint/source-size checks. The replacement Apple Silicon DMG at the path above has
SHA-256 `3738f08db502ea2ba1fada3b19e01b3071a1f3c22bfbcead06244d872e9e37bd`.
Both the built app and the copy mounted from the DMG passed signature and packaged
runtime checks. The production relay remains on the preceding deployed version;
no relay code changed. Notarization remains unavailable. Verification logs:
`/tmp/chief-chat-lifecycle-commit.log`, `/tmp/chief-chat-lifecycle-dmg.log`,
`/tmp/chief-chat-lifecycle-mounted-runtime.log`.

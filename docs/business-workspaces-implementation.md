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

### Latest review corrections and scheduled teams

All follow-up changes remain uncommitted pending Daniel's review.

- Codex ACP 1.6.2 and native Codex 0.148.0 are installed on demand, not bundled in
  the DMG. Assignment starts setup, a progress toast tracks download, SHA512-pinned
  archives are verified before extraction and cached atomically. Network failures
  retry. Isolated download and ACP initialize passed without invoking a model.
- Durable scheduled teams and signed webhooks are documented in
  `docs/scheduled-mission-runs.md`, including the public API and sender example.
  Cron/manual/webhook triggers share one run model, immutable brief and phase
  handoffs. Stop, retry, deadlines, approval and channel access are enforced.
- Calendar remains the primary schedule view. Direct create/edit supports the
  team, mission, expected result, constraints and timing. Run history links to
  evidence in the originating thread.
- Blank month cells now have subtle diagonal hatching. The Schedules popover is
  flat, with readable 14px empty text. Files sorting uses the shared Radix/shadcn
  Select. Repository connection uses restrained tabs and readable copy; private
  credential instructions are only expanded when relevant.
- Overview surfaces actual recent agent-created files with links to their output,
  and only shows analytics with real data. Missing metrics are not rendered as
  zero. Upcoming work includes native relay jobs and its empty state fills and
  centres in the available card space.
- Verification: all 18 typechecks, repository lint/source-size and focused critical
  relay tests. The focused relay set covers schedules, external inbound/tools and
  native agent queues (20 cases). Codex setup/adapter checks cover five cases.
  Browser-reviewed actual editor, details, webhook settings, Files Select,
  schedule popover and hatched calendar. Live subscription business turns and
  physical iOS notifications still need Daniel's normal test pass.

Release verification (2026-09-05 21:10 AEST):

- Production relay version: `b59705d6-3c93-4bd8-894c-4bf386b6ede7`.
  `/health` returns OK; unauthenticated webhook management returns 401.
- Rebuilt DMG: `apps/desktop/src-tauri/target/release/bundle/dmg/Chief_0.1.0_aarch64.dmg`.
  Size: 58,083,688 bytes. SHA256:
  `ca7835935e22124d28be07e648d0e2101a4ada1d388da8914e943a0722554450`.
- Mounted the DMG read-only, verified its app signature, and passed the packaged
  plugin-host startup check from the mounted copy. No Codex ACP/native distribution
  is present in packaged resources. Apple notarization was skipped because the
  required Apple credentials are not configured; Developer ID signing passed.
- HEAD remains `83851513`; follow-up implementation has not been committed.


### Device collaboration follow-up (September 5)

- [x] Commit the reviewed implementation in four focused, one-sentence commits, as authorized.
- [x] Fix Codex rejecting Chief relay MCP calls because ACP names them `mcp.chief_relay.*`.
- [x] Expose public-channel self-join to desktop, phone, hosted and external agent tools; keep private invitations enforced.
- [x] Use the live roster for mentions, including nested specialists and custom device agents; exclude the current user from the picker.
- [x] Personal device agents default to owner-only messaging with a workspace sharing toggle on desktop and mobile.
- [x] Enforce messaging on DM creation, existing DM writes, direct invokes, channel dispatch and every scheduled step; separate configuration/removal ownership from messaging permission.
- [x] Only start device cells belonging to the signed-in user, even when another user's agent is shared for messages.
- [x] Restore expandable, colored specialist DM entries and direct routing to individual specialists.
- [x] Use a dark mention-popover shadow and a single thicker, wider-spaced calendar hatch.
- [x] Verify the real picker/sidebar/calendar components in the in-app browser and compile the iOS simulator app.

Owner-approved scheduled teams carry the stored approving user through their steps. Unsolicited messages from other agents need workspace sharing enabled; this avoids treating a coworker's request as the owner's authorization. Phone background execution remains subject to iOS lifecycle limits; no physical-phone background run is claimed here.

The four reviewed commits are `f96c977c`, `4163e07f`, `daa65944`, and `0d9132d2`. This follow-up was approved for focused commits in the September 5 review.

### Schedule and artifact follow-up

- [x] Replace schedule form with a guided brief, team and timing flow; shadcn selects and searchable avatar multiselect.
- [x] Create a mission channel within scheduling; keep outcome, constraints and time budget out of the required flow.
- [x] Publish relay artifacts deliberately into chat with cards that deep-link to channel Canvas.
- [x] Replace duplicate Canvas empty states with one quiet surface; list and open artifacts inside the channel, with named tabs.
- [x] Pull and inspect Executor artifact implementation (38915a3); retain durable identities and previews while preserving the relay security boundary.
- [x] Verify the complete pass before the production relay deployment and final DMG rebuild.

Artifact delivery uses the existing versioned relay files store. `files.write` accepts Markdown, self-contained HTML, CSV and JSON. `channels.messages.post` takes `artifactIds` and resolves each against visible files in that exact channel. The same flow is available to device, hosted and external relay agents; mobile agents use `workspace_file_write` and `relay_message_post`. Creating channel artifacts uses `messages.send`, while broad workspace administration remains separate. Binary publishing keeps the existing signed asset path. Artifacts cannot silently move channels, and writes enforce the expected version.

Desktop Canvas keeps documents and interactive tools inside the channel, with a named open-artifact tab, list/grid views, source editing, downloads and discussion links. HTML runs without the app origin or bridge in a sandboxed iframe; CSP blocks network connections and external resources. Previews disable scripts. Mobile has artifact cards and a nonpersistent HTML viewer with navigation blocked. These artifacts are self-contained outputs, without Executor's live credential-backed tool bindings.

Verified the actual schedule dialog, searchable keyboard-driven team selection, new-channel setup, card-to-Canvas navigation, Markdown rendering and an interactive HTML button in the in-app browser. Relay tests cover artifact creation, optimistic revisions, cross-channel attachment rejection and ordinary messaging permissions without workspace-admin grants. Real subscription turns and physical-device notification/background behavior remain Daniel's test pass.

Release verification (2026-09-05 22:28 AEST):

- Production relay: `7fb9f541-e084-4552-9f6b-815560182c8a`, deployed through Wrangler. Health returns OK and anonymous file access returns 401.
- DMG: `apps/desktop/src-tauri/target/release/bundle/dmg/Chief_0.1.0_aarch64.dmg`, 59,839,459 bytes. SHA256 `233818b6769fc5cf0e9679cbcb4f62f50c7b1c4e06ec60f9cd630dab9d0d8e97`.
- The initial Tauri DMG packaging step failed and left a writable image mounted. Detached that temporary mount, rebuilt the final app, then created a clean compressed disk image containing the signed app and Applications shortcut. Verified the app signature and packaged plugin-host startup from the mounted read-only DMG. No Codex adapter distributions are bundled.
- All 18 workspace typechecks and lint/source-size checks passed. Critical artifact contract and relay tests passed, including an external agent creating, revising and presenting a file and rejecting cross-channel publication. The iOS simulator build passed. Developer ID signing passed; Apple notarization is unavailable without Apple credentials.
- At release time, collaboration, schedule composer and Canvas changes were uncommitted for review. Daniel subsequently approved committing this work in focused commits.

### Mention and sidebar review

- [x] Resolve full live agent names in composer and sent-message chips, including multiword names and custom device agents; keep a mention together and remove it as a whole with Backspace.
- [x] Move Chief's nested agent list 4px left.
- [x] Give the schedule channel-creation icon an explicit 8px gap.
- [x] Commit the approved pending implementation in focused, one-sentence commits without co-author trailers.
- [ ] Future exploration, deliberately deferred: people can bring their own agent teams into an organization, display those teams beneath their owner in the sidebar, and share messaging access with coworkers. Consider an owner-qualified handle such as `chief@danielsims`, preserving stable agent IDs and explicit sharing permissions. Do not implement ownership transfer or cross-organization agent sharing as part of this visual pass.

The spacing and mention follow-ups are source changes after the 22:28 DMG above; that image does not contain them.

Approved implementation commits: `e6c117fb` (personal-agent access), `4d097fd6` (channel tools and artifact publishing), `896c5a67` (Canvas), `5eff1810` (schedule composer), and `880f098e` (live mentions and specialist DMs). All 18 typechecks and staged lint/source-size checks passed. Eight mention tests passed, including multiword agents and whole-chip deletion; the real composer and message renderer were visually checked in the in-app browser.

### Schedule input and agent API follow-up

- Replace conversational headings with New schedule, Instructions, Lead agent, Teammates and Channel.
- Make the searchable combobox input the only teammate trigger, with removable selected agents. Keep the list within the dialog scroll boundary and available space; verify pointer and keyboard scrolling through a 24-agent roster.
- Remove the channel-name field. Move channel, membership, mission and schedule setup into one relay transaction with stable identities and idempotent retries.
- Expose the complete configuration, optional agent-authored channel name and user invitations, and skip dates through desktop/hosted/external tools and a mobile scheduling tool. Keep activation and webhook-secret administration within existing owner approval rules.
- Verify eight relay scheduling cases, including atomic rollback, retry identity and an agent creating a webhook proposal without an existing channel. Verify the actual guided form in the browser and compile iOS.

Release verification for this follow-up: relay version `a880149d-23d7-4774-b630-47cb076f987f`; production health OK and anonymous file access 401. Rebuilt `Chief_0.1.0_aarch64.dmg` (60,069,962 bytes; SHA256 `2f72ed6efd7d450f8a92b65590aa1dbb77551d1bfec9260cc17bfa26b75a91d6`). Verified the signed app and packaged plugin host from the mounted image, with no Codex adapter bundled. All 18 typechecks, lint/source-size checks, eight scheduling tests and the iOS simulator build passed. Apple notarization remains unavailable without credentials. This follow-up remains uncommitted for review.

### Calendar history and agent activity follow-up

- Preserve elapsed scheduled occurrences in the calendar using recorded relay runs, including paused schedules, and retain due timestamps through the desktop clock transition. Historical cards stay readable at reduced opacity and remain available for inspection.
- Restore continuous vertical month scrolling, month-heading synchronization and explicit Today/date jumps. Fetch recorded history for the visible month and its neighbors, with workspace/channel visibility enforced by the relay.
- Group conversation activity by agent identity and most recent activity, with live roster names and avatars. Selecting an agent reveals full-width tool rows and expandable reasoning; remove the generic workspace/earlier-activity card hierarchy.
- Add focused regressions for interleaved agents and durable calendar history after a schedule is paused. Browser verification covers month scrolling, Today, completed-card retention, agent selection and reasoning expansion.

Release verification (2026-09-06): relay version `c2d20a51-84d2-4d9a-b782-671c8627b850`, production health OK and anonymous file access 401. Rebuilt `Chief_0.1.0_aarch64.dmg` (59,843,122 bytes; SHA256 `98c8b6e93dd9073381eed68f777c59500c073047052c5ba1e2aedf9ac011efb0`). Verified the signed app and packaged plugin host inside the mounted read-only image; no Codex adapter is bundled. All 18 typechecks, lint/source-size checks, nine relay scheduling tests and three conversation-activity tests passed. Browser review used the actual calendar and Activity components. Signing passed; notarization remains unavailable without Apple credentials. Source changes remain uncommitted for review.


### Scheduled handoff and deployment follow-up

Scheduled runs now publish one workspace-authored announcement with a compact run card. Internal phase instructions stay in the job or delivery payload; they are not posted as messages from the user. Replies continue in the run thread.

The Eve adapter reports turn completion separately from visible replies, including when a channel tool already published the work. Reply publication and completion are serialized per delivery, and duplicate completion receipts are idempotent. Completing a scheduled step through the run reporting tool also advances the step. Generated delivery prompts include the shared concise, friendly voice guidance and prohibit em dashes.

Connected Eve agents now expose **Update deployment** in their runtime settings. Desktop deployment always goes through the authenticated relay so the generated agent source is registered in Projects. Agent projects link back to agent settings. Existing deployments created through the previous desktop shortcut still need an explicit redeployment to register their source and install the updated adapter. The hosted adapter runs in Eve, separately from the relay and desktop releases. Chief Git remains a clone-only source snapshot; pushing edits is not supported. No existing Eve deployment was changed during this pass.

The specialist guide line moves left by 1px without shifting the agent rows; the real sidebar component was reviewed in the in-app browser. Repository formatting was repaired with `pnpm format:fix`, including the files reported by CI.

Release verification: production relay `7d54aeb1-baec-453f-adf3-4a91dcafb438`, health OK and anonymous file access 401. The rebuilt Apple Silicon DMG is 59,845,514 bytes with SHA256 `d045827a274ba3da1645b26cf7d04c4837e96b6f60eccd321723ae47c32e50d4`. The app inside the mounted image passes Developer ID signature and packaged plugin host verification; the Codex adapter is not bundled. Notarization remains unavailable without Apple credentials. All 18 typechecks and formatting tasks, repository lint/source-size, 21 relay checks and three adapter-generation/completion checks pass. The iOS simulator build passed for the scheduled-run card. Changes remain uncommitted.


### Parent-avatar guide alignment correction

The specialist guide now uses an independently positioned 1px line centred at the parent avatar's midpoint (8px row padding plus half of the 16px avatar). The rendered component measures a 0px difference between the guide and avatar centres; child-row indentation is preserved. Focused lint and formatting checks pass, and the desktop build passes TypeScript and production compilation.

Rebuilt and verified the signed app and packaged runtime inside the DMG: 60,063,967 bytes, SHA256 `f45d421e5bb5a8e78c5f12f67040c6df3376f000aed988e70db6c0d0c14b6772`. No Codex adapter is bundled. This desktop-only correction does not change the production relay or Eve deployments. Source remains uncommitted.


### Calendar month-title handoff

The scrolling calendar hands the month title to the page header when the new month's first row is within 64px of the weekday header, replacing the previous 4px threshold. This starts the existing label fade 60px earlier. Browser verification of January to February 2027 confirmed January with the grid label visible at 80px, February with the grid label hidden at 48px and 16px, and correct restoration when scrolling back. Focused formatting and lint checks pass.

Rebuilt DMG: 59,848,325 bytes, SHA256 `0dba4f89bd3f26213735d8cb54d1bbf5882378ad112bd4eb2a34bd3f97def89d`. Desktop compilation and TypeScript pass. The signed app and packaged plugin host were verified inside the mounted image, with no bundled Codex adapter. Source changes remain uncommitted; this calendar change needs no relay deployment.

### Scheduled Eve collaboration and mobile notification recovery

Declared Eve children now inherit their parent's external runtime. Generated child
sessions receive workspace tools and encrypted delivery context, and publish under
the child's identity in the scheduled thread. Parent background acknowledgements
cannot complete a child's run step. The deployment generator and relay own these
changes; there are no manual patches in the deployed agent project.

The deployment update flow now explicitly reuses an existing registration without
rotating credentials or replacing the live endpoint during the build. The generated
repository is saved to Projects. The desktop run announcement aligns with the chat
body and no longer includes the calendar/clock icon.

Mobile notification links persist until workspace hydration and navigation finish.
Newer taps supersede older pending links, and thread roots outside loaded history
are fetched directly. Opening Activity acknowledges errors across app launches;
newer successful work suppresses recovered failures while history remains available.

Verification on 7 September: all 18 typecheck and formatting tasks pass, as do
repository lint/source-size checks, the generated Eve build and six adapter tests,
nine external-runtime/update/handoff tests, nine conversation tests, and seven
focused iOS notification/acknowledgement tests. The full iOS suite still reports
onboarding and launch-navigation assertion failures. The reported physical-device
notification launch failure could not be reproduced or tied to a crash report, so
it still requires a real-device push-tap check.

Production relay: `8d5403bd-6610-4bcd-aa0f-5453bd37c8f5`, health OK.
`chief-program` was rebuilt through the normal app deployment flow at Vercel
`GCRsDpFizbZEDSva6coaUBrNvgHU`. A retry in the marketing channel produced a Chief
reply at 12:28, a real Marketer contribution at 12:29, and Chief's assembled result
at 12:29. All three are in thread `67be4839-e478-4c79-bc8f-c22880b73a14`.
The generated `chief-program` repository is visible in Projects.

The signed Apple Silicon DMG is 60,065,398 bytes, SHA256
`e923de436a795ccddb3b163ccfaa254da1280fadd201ae71ff04498b3f56a723`.
Its mounted app passes Developer ID signature and packaged plugin-host verification;
no Codex adapter is bundled. The app is not notarized. Source changes remain
uncommitted.

### September 7: scheduled artifacts and explicit team expansion

- Added a lead-only `missions.addRunCollaborator` tool and public run API. It adds
  a concrete, replay-safe contribution to the current run without changing future
  schedules. Native scheduling preserves the lead's current step and queues a
  final review after added work. Permission and mission boundaries remain enforced.
- Packaged the shared artifact guidance into generated Eve root and child agents;
  production steps now save substantial output and post artifact references with
  brief chat updates. No deployment repository was patched manually.
- Added live scheduled-run matrix indicators to desktop cards and composer
  presence, with thread scoping, terminal-state cleanup and dynamic team avatars.
- Deployed relay version `7a3118ec-f832-4b8b-ad4e-ea938bfff01f` (health OK) and
  regenerated `chief-program` through the app, deployment
  `7QtHQoiW9ac1Qhwg7Ead3SRyRUbr`.
- Live verification: Marketer posted the launch post and demo script as artifact
  `ce23dbe4-20bc-5b30-81af-c96a0aaa76e6` in run thread
  `5b2a761f-8931-4772-9e45-a2c080d887bb`. Its chat card opened the complete document,
  including the script table, in the channel Canvas and header tab. The working
  indicator appeared while Marketer ran and cleared after completion.
- Verified 15 focused relay tests, then an additional dispatch regression (all
  four team tests passed), four generator/catalog tests, four activity-presence
  tests, all 18 workspace type checks and formatting checks, and repository lint.
  Existing source-length warnings remain. Browser review covered working and
  completed card states. Dynamic team expansion has integration coverage; the
  live marketing run used its existing Chief/Marketer team.
- Updated the signed arm64 DMG, 60,065,816 bytes, SHA-256
  `ebd776c6361166a44418381ceca5683680c68fd136aa8cb8c7f77b732f195282`.
  Mounted signature and packaged plugin-host verification passed. Notarization
  was not run. The temporary verification mount was detached after a busy retry.


### September 7: mobile scheduled-run parity and commit verification

- Added native scheduled-run cards with team avatars, current assignments, live
  matrix progress, thread navigation, and run details with stop/retry actions.
- Added channel Canvas access and artifact viewing from the run thread. On-device
  agents can save and present artifacts, report steps, and explicitly add run
  collaborators; successful thread posts do not produce duplicate completion text.
- Verified all 96 mobile unit tests and the scheduled-run UI test, including
  specialist identity, progress, opening the thread, and reading a saved artifact.
  Corrected two stale workspace-setup expectations. Older general launch UI tests
  were not rerun in this pass; their earlier navigation failures remain separate.
- Built and signature-verified the device app, installed it on the paired iPhone,
  and successfully launched both normally and from a cold start with a scheduled
  thread deep link. The app process remained alive after launch. An actual APNs
  notification tap still needs a physical-device check; a URL launch does not
  exercise the system notification delivery path.
- Repository formatting and all 18 typecheck tasks passed; lint/source-size passed
  with existing source-length warnings. Commit hooks repeat the staged checks.
- Grouped the accumulated work into focused commits covering formatting, scheduled
  execution, schedule setup, calendar history, generated deployments, chat activity,
  sidebar alignment, mobile parity, and these verification notes.

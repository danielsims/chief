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
- [ ] Phase E: Verify and hand back. Deploy the relay, build and verify the signed
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
- [ ] Commit coherent units, with no secrets or unrelated generated artifacts.
- [ ] Deploy production relay via Wrangler only after implementation is complete.
- [ ] Rebuild and verify the signed DMG and packaged local runtime.
- [ ] Report artifact path, production version, verified behavior, and remaining
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

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
- [ ] Phase C: Run the loop. Reproduce, change, inspect the real artifact, retain
  fixes that pass. Prefer typechecking, focused critical tests, and browser QA.
- [ ] Phase D: Keep the audit trail. Record decisions and evidence as work lands.
- [ ] Phase E: Verify and hand back. Deploy the relay, build and verify the signed
  DMG, report what Daniel should test.

The baseline is commit `64d29d68`, 190 files of previously unfinished work.
All 18 workspace typechecks passed; baseline lint failed. The checkpoint hook
was explicitly skipped to preserve the unfinished state, not to call it ready.

## Acceptance checklist

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

- [ ] Chief treats each workspace as a distinct business and asks a short,
  contextual intake about desired outcomes, priorities, constraints, and authority.
  Existing business context is reused rather than repeatedly requested.
- [ ] Real work receives a feature/campaign channel, clear owner, collaborators,
  outcome, and a durable brief. Handoffs actually invoke the other agent.
- [ ] Engineering missions connect to a repository and produce reviewable changes.
- [ ] Marketing missions propose useful work, produce drafts/assets, and request
  the specific approval needed for publishing or spending.
- [ ] Iterative missions record a baseline, metric/source, evaluation window,
  hypothesis, result, and keep/revert decision. Budget and stop conditions bound
  repetition; missing data remains unknown and marketing noise is not a win.
- [ ] Recurring execution is explicit and visible in Schedule, with work paused
  or completed when its outcome or limits are reached.

### Notifications and inbox

- [ ] Inbox detail renders Markdown using the conversation renderer.
- [ ] Inbox previews and desktop/iOS banners display readable plain text, with
  links, headings, emphasis, and code markers removed before truncation.
- [ ] Notifications use the existing native push path with a clear permission
  state and conversation deep link. No Hark dependency or extra user webhook setup.
- [ ] Review Hark for useful design ideas; record any later enhancement separately.

### Schedule

- [ ] Make running, upcoming, paused, failed, and awaiting-approval work understandable.
- [ ] Provide a useful empty state and an obvious way to arrange new work.
- [ ] Retain working review/edit/pause/resume/run controls and calendar navigation.
- [ ] Verify the page in the browser and with empty/populated data.

### Files and integrations

- [ ] Improve browsing, filtering, selection, empty states, and file previews.
- [ ] Support images and other media where the existing storage can carry them;
  allow agents to publish usable file artifacts rather than text-only placeholders.
- [ ] Keep authorization on file access and validate upload limits/types.
- [ ] Evaluate Notion/Google Drive-style connections through the existing plugin
  system. Avoid building duplicate connector infrastructure; document what's
  supported now and what depends on connecting an external service.

### Analytics and private repositories

- [ ] Decide how Analytics should appear in the business workflow. Prefer relevant
  channel artifacts and evidence over an unexplained permanent dashboard.
- [ ] Verify private-repository attachment and access from the actual project flow.
  Provide an actionable connection route without embedding tokens in URLs/messages.

### Security and maintenance

- [ ] Inspect user/agent/workspace boundaries, file access, secrets, plugins, and
  private-repo credential handling. Fix concrete issues and retain evidence.
- [ ] Remove dead helpers and duplicate implementations encountered in the work.
- [ ] Revisit the 500-line rule. A 750-line ceiling is acceptable when it keeps a
  coherent module together; do not concatenate unrelated modules to meet a quota.
- [ ] Repair baseline lint failures relevant to shipping this branch. Avoid broad
  test proliferation; critical integration checks must exercise real behavior.

### Delivery

- [ ] All relevant typechecks, lint, focused critical checks, and UI verification pass.
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
- Refocus currently replaces both RelayClient and RelayRuntimeClient. Preserve
  transport identity while refreshing snapshot data for the same account/workspace.
- Hark reference: https://github.com/R44VC0RP/hark. Keep native notifications;
  its distinction between stored rich content and a short banner is useful here.
- Iteration reference: https://github.com/karpathy/autoresearch. Adopt explicit
  evaluation and recorded experiments, not unbounded iteration on noisy business metrics.

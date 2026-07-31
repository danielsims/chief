# Chief Channel Workspace PRD

Status: implementation source of truth  
Branch: `feat/channel-ux`  
Date: 1 August 2026  
Owner: Chief product/runtime

## One-sentence brief

Turn Chief's post-onboarding desktop experience into a polished, channel-first
workspace where people and named agents work together, browsers and artifacts
live inside the conversation that produced them, and the same Chief product can
operate through desktop, Buzz, Slack, mobile, WhatsApp, and future surfaces.

## Executive decision

Chief should adopt the **workspace feel** of Buzz without making Buzz, Slack,
Nostr, or the desktop app the product's source of truth.

The product is the Chief team, its work contexts, its durable work, its tool
grants, and its artifacts. Desktop is the richest first-party client. Buzz,
Slack, and future messaging clients are projections of the same product model.

The immediate desktop direction is:

1. Channels replace the undifferentiated conversation list as the primary work
   navigation.
2. A continuous, resizable workspace sidebar replaces the icon-only feature
   rail after onboarding.
3. Named Chief agents appear as people in a channel, not hidden implementation
   details or provider/model selectors.
4. The main content panel feels like a high-quality native chat application:
   persistent header, quiet metadata, generous readable transcript width,
   contextual menus, stable composer, and no page-within-a-page framing.
5. Browser sessions are first-class conversation work surfaces rendered with
   `@browser-ui/react`, with inline, picture-in-picture, and fullscreen modes.
6. Executor artifacts become the general durable output substrate, while Chief
   keeps curated domain views where a dedicated interaction is genuinely
   better than a gallery.
7. Chief ships one authored light theme and one authored dark theme. A theme
   framework may allow more later, but theme quantity is not a goal.
8. Nostr may carry cross-client channel events later, but protocol terms,
   keys, relays, event kinds, and transport health must remain invisible in the
   normal Chief product.

## Why this work exists

Chief currently has strong onboarding, a distinctive restrained brand, a good
landing/overview direction, capable agents, and increasingly powerful runtime
surfaces. After onboarding, however, it presents those capabilities as a rail
of separate product pages:

- Overview
- Conversations
- Files
- Agents
- Schedule
- Analytics
- Campaigns
- Prospects
- Trending

That taxonomy describes Chief's implementation, not how a person thinks about
work. It fragments a single initiative across chat, a dashboard, a file, a
schedule, and a domain table. Browser work appears as a utility split panel
instead of a moment in the team's shared history.

Buzz demonstrates a better interaction model:

- one continuous workspace rather than independent feature pages;
- named, durable channels as contexts;
- compact group headings with collapsible sections;
- rows with strong selected, hover, unread, and running states;
- right-click actions where users expect them;
- a content surface that feels visually lifted from the sidebar without being
  a floating dashboard card;
- a stable channel header and message composer;
- agents that appear as participants;
- attachments and browser sessions that live in the timeline.

The goal is not a visual clone. The goal is to carry those interaction
principles into Chief's quieter, sharper brand.

## Product principles

### Chief remains recognizably Chief

Preserve:

- the existing onboarding flow and its conversational tone;
- the Chief mark and Geist Pixel display voice;
- the warm, editorial landing/overview page;
- restrained copy, borders, motion, and color;
- the sense that Chief is a calm operating partner, not a noisy community app.

The workspace may become denser and more native without becoming generic
Slack cosplay.

### Channels are contexts, not folders

A channel is a durable context with:

- a name and optional purpose;
- participating humans and agents;
- a timeline;
- active work and attention state;
- attached browser sessions;
- related artifacts;
- permissions and visibility;
- optional recurring work.

Channels must not become a cosmetic grouping around unrelated legacy chats.
The first implementation may project current root chats into channel rows, but
the target model explicitly owns channels.

### Work should appear where it happens

When an agent browses, creates a report, drafts content, requests approval, or
finishes scheduled work, that state belongs in the originating channel.

Do not make the user leave the conversation merely to understand what the team
is doing. Dedicated views are for browsing across work, editing complex
objects, or focused analysis—not for basic visibility.

### Protocols are infrastructure

People should see "Marketing", "Chief", "Analyst", "Private", "Connected",
or "Waiting for you". They should not see "Nostr", "relay", "event kind",
"npub", "MCP Apps", or transport error codes unless they deliberately open
advanced diagnostics.

### Generated UI earns its place

Executor artifacts are powerful precisely because an agent can create a useful
interactive surface. They must not create a junk drawer of inconsistent mini
apps.

Chief therefore owns:

- the artifact gallery chrome;
- naming and description quality;
- loading, empty, error, approval, and stale states;
- a small visual contract for generated content;
- curation into channel and workspace contexts;
- quality gates before an artifact is featured.

### One product, many surfaces

Desktop, Buzz, Slack, mobile, and WhatsApp are clients. They do not define
Chief's durable product semantics.

```ts
interface ChiefSurfaceAdapter {
  surface: "desktop" | "buzz" | "slack" | "mobile" | "whatsapp";
  projectChannel(channel: ChiefChannel): Promise<SurfaceChannelRef>;
  projectMessage(message: ChiefMessage): Promise<SurfaceMessageRef>;
  projectArtifact(artifact: ChiefArtifact): Promise<SurfaceArtifactRef>;
  projectAttention(item: AttentionItem): Promise<SurfaceAttentionRef>;
}
```

## Goals

### G1. Channel-first daily use

A returning user should land in a workspace where the next useful action is
usually opening a channel, reading what changed, and replying.

### G2. Native desktop quality

The shell must support right-click menus, keyboard focus, resizable navigation,
high-density lists, native-feeling hover/selection, drag regions, and carefully
authored light/dark presentation.

### G3. Visible agent collaboration

Chief and specialists should read as team members with names, roles, presence,
and attributable messages or work cards. Model/provider selection remains an
advanced execution setting, not the primary identity in the composer.

### G4. Conversation-attached browser work

A browser session should appear in the channel timeline when started, expand
into an interactive first-party surface, and preserve a meaningful completed
state or recording when the live session ends.

### G5. Durable, curated artifacts

The user should be able to find historical outputs by channel, agent, type,
title, and recency, reopen the exact artifact, and ask Chief to update it in
place.

### G6. Surface portability

Channel identity, membership, messages, work, and artifacts must be representable
outside the desktop app without duplicating the Chief runtime.

## Non-goals for the first implementation

- Building a public social network or exposing Nostr concepts.
- Replacing Chief's onboarding or landing page.
- Shipping a theme marketplace or Buzz's full theme catalog.
- Migrating every legacy domain record into an Executor artifact immediately.
- Making every specialist produce visible chatter for routine tool calls.
- Implementing cross-device browser streaming before the local first-party
  browser experience is excellent.
- Treating raw agent-generated JSX as trusted product chrome.

## Information architecture

### Primary shell

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ native title/drag region                                                     │
├──────────────────────────┬───────────────────────────────────────────────────┤
│ Chief workspace          │ # marketing                              ◉ 3     │
│ [workspace switcher]     │ Campaign planning and weekly growth work          │
│ [search]                 ├───────────────────────────────────────────────────┤
│                          │                                                   │
│ HOME                     │ Chief        9:42                                 │
│   Overview               │ Here is what changed since yesterday…             │
│   Activity               │                                                   │
│                          │ Analyst      9:44                                 │
│ CHANNELS                 │ [Growth report artifact]                          │
│   # hq                   │                                                   │
│   # marketing       •    │ Chief is using a browser                          │
│   # prospecting          │ [interactive browser surface]                     │
│   # engineering     2    │                                                   │
│                          ├───────────────────────────────────────────────────┤
│ DIRECT MESSAGES          │ Message #marketing…                               │
│   Chief             ◉    │ [attachments] [agent picker]              [send] │
│   Analyst                │                                                   │
│   Content Writer         │                                                   │
│                          │                                                   │
│ ARTIFACTS                │                                                   │
│   Recent work            │                                                   │
│                          │                                                   │
│ [profile] [theme] [⚙]    │                                                   │
└──────────────────────────┴───────────────────────────────────────────────────┘
```

### Sidebar sections

The initial authored sections are:

1. **Home**
   - Overview
   - Activity / Inbox when the data model supports it
2. **Channels**
   - Chief HQ
   - Marketing
   - Prospecting
   - Engineering when enabled
   - Setup only while active or when the user asks to show private channels
3. **Direct messages**
   - Chief
   - enabled specialists
4. **Work**
   - Artifacts
   - Schedule
5. **Footer**
   - workspace/profile switcher
   - runtime status
   - appearance
   - settings

Analytics, campaigns, prospects, trends, drafts, and files are no longer all
equal global navigation destinations. They become either:

- artifact types;
- channel tabs/filters;
- curated cross-work views under Work;
- deep links from a message or artifact;
- retained dedicated editors when their interaction genuinely benefits from
  structure.

### Sidebar references from Buzz

The implementation should study and preserve the reasoning behind these Buzz
surfaces:

- `desktop/src/features/sidebar`: continuous workspace navigation rather than
  a detached icon rail.
- `data-sidebar="group-label"`: quiet uppercase section labels with clear
  hierarchy and tight optical alignment to row icons.
- channel rows such as `data-testid="channel-general"`: full-width hit targets,
  hover/selected surfaces, unread state, and row-local actions.
- Radix context menus used by channel rows: lifecycle and management actions
  appear at the pointer without permanently cluttering the list.
- `sidebar-pinned-header`, `sidebar-channel-content`, and
  `.buzz-sidebar-scrollbar`: pinned search/primary actions, one continuous
  scroll region, and authored scrollbar behavior.
- `data-buzz-content-surface`: a continuous main panel whose subtle light-mode
  separation and dark-mode containment create depth without dashboard-card
  slop.

Chief should reproduce the quality bar and interaction logic, not Buzz's exact
palette, icon set, or social/community vocabulary.

## Main channel surface

### Header

The channel header is 52–56px tall and contains:

- channel glyph and title;
- one-line purpose, when space allows;
- participants or active-agent indicator;
- search/details actions;
- drag region in unused space;
- no oversized page heading.

For a direct conversation, use the agent avatar/name and role instead of a
hash glyph.

### Timeline

Messages use a Slack-like authored timeline rather than alternating speech
bubbles:

- avatar/name/time anchors each speaker block;
- consecutive messages by the same speaker collapse redundant identity chrome;
- user and agent messages share the same readable content column;
- tool execution is secondary disclosure beneath the responsible agent;
- system events are quiet timeline separators;
- approval and input cards remain prominent because they require action;
- browser and artifact cards can use the full available content width.

The current right-aligned user bubble should be retired in channel mode. It is
appropriate for a support chatbot, not a team room.

```tsx
<ChannelMessageGroup
  author={{ kind: "agent", id: "analyst", name: "Analyst" }}
  timestamp={message.createdAt}
  status={message.status}
>
  <Markdown>{message.text}</Markdown>
  {message.artifacts.map((artifact) => (
    <ChannelArtifact key={artifact.id} artifact={artifact} />
  ))}
</ChannelMessageGroup>
```

### Composer

The composer is stable at the bottom of the channel and should feel like one
carefully made native control:

- one outer surface;
- multiline editor;
- attachment and slash/action entry points;
- visible recipient/agent context;
- send/stop in a consistent position;
- model/provider selection under an advanced menu;
- suggestions only in an empty/new channel, not above every ordinary reply.

Suggested identity model:

```ts
type ChannelRecipient =
  | { kind: "channel"; channelId: string }
  | { kind: "agent"; agentId: ChiefAgentId };

interface ChannelComposerIntent {
  recipient: ChannelRecipient;
  text: string;
  attachmentIds: string[];
  executionOverride?: ChatExecutionSelection;
}
```

## Channel behavior

### Default channels

New workspaces keep onboarding as-is, then create/project:

| Channel | Purpose | Visibility |
| --- | --- | --- |
| Chief HQ | priorities, weekly review, decisions, cross-team work | workspace |
| Marketing | analytics, content, positioning, campaigns | workspace |
| Prospecting | research, leads, outreach angles | workspace |
| Engineering | technical growth work when enabled | workspace |
| Setup | credentials and integration setup | private |

These match the portable Buzz team semantics already defined in
`packages/buzz-team`.

### Context menu

Right-clicking a channel row opens a menu with only valid actions:

- Open
- Mark read/unread when unread state exists
- Add to / remove from favourites
- Rename for user-created channels
- Edit details
- Mute notifications
- Leave, archive, or delete only when ownership/permissions allow

The first implementation may expose a smaller truthful subset. Do not show
disabled fantasy actions purely to make the menu look complete.

### Group headings

Section headings are collapsible, remember state per workspace, and expose a
plus/menu affordance on hover where creation is supported.

```ts
interface ChannelSectionPreference {
  workspaceId: string;
  sectionId: "home" | "channels" | "direct" | "work" | string;
  collapsed: boolean;
  order: number;
}
```

Local persistence is acceptable for presentation preferences. Channel
identity, membership, and permissions are not local presentation state.

## Browser sessions

### Decision

Install and use the published `@browser-ui/react` package. Chief should stop
composing its own viewport, overlay, and display-mode chrome once parity is
verified.

The host continues to own:

- browser process/session creation;
- stream URL;
- navigation and reload commands;
- agent activity state;
- close/termination;
- authorization and control lease enforcement.

Browser UI owns:

- frame and connection presentation;
- interactive viewport input;
- agent-operating treatment;
- inline, picture-in-picture, and fullscreen display modes;
- first-party control rail.

```tsx
import {
  Browser,
  BrowserDisplayTrigger,
  BrowserFullscreenTrigger,
  BrowserPictureInPictureTrigger,
} from "@browser-ui/react";
import "@browser-ui/react/styles.css";

<Browser
  streamUrl={browser.streamUrl}
  operating={browser.agentActive}
  operatingLabel="Chief is operating this browser"
  onTakeControl={browser.takeControl}
  onViewportResize={browser.resize}
  colorScheme={theme}
  variant="bare"
  showPictureInPicture
  showFullscreen
  displayControls={
    <>
      <BrowserPictureInPictureTrigger />
      <BrowserFullscreenTrigger />
      <BrowserDisplayTrigger
        aria-label="End browser session"
        onClick={browser.close}
      >
        <CloseIcon />
      </BrowserDisplayTrigger>
    </>
  }
/>
```

### Timeline lifecycle

Browser sessions have explicit conversation states:

- **Preparing**: compact skeleton and task label.
- **Operating**: live inline viewport; agent activity is clear.
- **Waiting for you**: live viewport; human interaction is primary.
- **Complete**: compact summary with final URL, outcome, and optional recording.
- **Failed**: concise cause and retry/reopen action.

The initial vertical slice may keep the live surface in a right-side panel for
space, but its identity and lifecycle must be anchored to the active channel.
The target is a timeline attachment that can expand without losing channel
context.

## Executor artifacts

### What Executor now provides

Executor 1.5.37 includes a first-party persistent artifact system:

- `create-artifact` stores model-generated React UI;
- `list-artifacts` makes prior outputs retrievable by title/description;
- `show-artifact` re-renders an existing artifact;
- updates preserve artifact identity through `artifactId`;
- artifacts are user-owned in v1 and carry owner tier for later sharing;
- clients with MCP Apps support receive an inline UI resource;
- other clients receive a stable product deep link;
- the console provides gallery, detail, rename, and delete surfaces;
- generated UI has static guards, provider-pairing checks, and a first-render
  smoke test;
- gallery previews are real sanitized render markup, upgraded after a settled
  browser render;
- artifact tool calls bind integration roles to the viewer's connections;
- artifact actions use normal Executor approval policy.

Primary references in the Executor source:

- `plans/artifacts.md`
- `packages/core/sdk/src/artifact.ts`
- `packages/core/api/src/handlers/artifacts.ts`
- `packages/hosts/mcp/src/create-artifact.ts`
- `packages/react/src/pages/artifacts.tsx`
- `packages/react/src/pages/artifact-detail.tsx`
- `packages/react/src/components/artifact-preview.tsx`

### Chief integration decision

Executor artifacts should become Chief's **general work artifact substrate**,
not an iframe-shaped replacement for every domain.

Replace or converge:

- one-off analytics dashboards;
- research reports;
- campaign plans and performance summaries;
- prospect research collections;
- content calendars and review boards;
- interactive tables and charts that agents currently save as isolated
  generative parts or files.

Retain curated Chief views when they offer durable product value:

- Overview / landing page;
- attention and approval queue;
- Schedule editor and run state;
- Integration settings;
- structured campaign mutation/review controls where launching or budget
  changes need explicit semantics;
- structured prospect workflow if it supports bulk review/actions better than
  a generated surface.

### Anti-slop contract

An artifact may be featured in Chief only when it has:

- a useful, human title;
- a one-sentence description;
- an originating channel and agent;
- clear updated time;
- a successful first render;
- a meaningful empty/loading/error state;
- no fake data posing as live data;
- no attempt to imitate Chief's global navigation or dialogs;
- readable light and dark presentation;
- keyboard-accessible controls;
- bounded actions with normal Executor approval.

```ts
interface ChiefArtifactProjection {
  id: string;
  executorArtifactId: string;
  channelId: string;
  messageId?: string;
  createdByAgentId: ChiefAgentId;
  title: string;
  description: string;
  status: "draft" | "ready" | "stale" | "failed";
  quality: {
    firstRenderPassed: boolean;
    supportsDark: boolean;
    hasEmptyState: boolean;
    hasErrorState: boolean;
  };
  createdAt: number;
  updatedAt: number;
}
```

Chief should not fork Executor's renderer. It should project artifact metadata,
host/deep-link the Executor artifact securely, and own the surrounding channel
and gallery experience.

## Themes and visual system

### Theme scope

Ship:

- **Chief Light**: warm-white content, slightly warmer sidebar, dark ink,
  restrained blue for active/running states.
- **Chief Dark**: near-black content, lifted charcoal sidebar, off-white ink,
  the same blue system with adjusted luminance.
- **System**: follows OS preference and resolves to one of the authored themes.

Do not ship a theme catalog yet. Two meticulously authored modes are more
valuable than twelve token substitutions.

### Surface hierarchy

Light:

```css
:root {
  --background: hsl(42 22% 98%);
  --sidebar: hsl(40 18% 94%);
  --surface: hsl(0 0% 100%);
  --surface-raised: hsl(42 18% 97%);
  --foreground: hsl(0 0% 8%);
  --muted-foreground: hsl(0 0% 40%);
  --border: hsl(40 8% 84%);
  --channel-hover: hsl(0 0% 0% / 0.04);
  --channel-active: hsl(0 0% 0% / 0.07);
  --status-active: hsl(214 88% 56%);
}
```

Dark:

```css
.dark {
  --background: hsl(0 0% 5%);
  --sidebar: hsl(0 0% 7%);
  --surface: hsl(0 0% 8%);
  --surface-raised: hsl(0 0% 10%);
  --foreground: hsl(0 0% 96%);
  --muted-foreground: hsl(0 0% 58%);
  --border: hsl(0 0% 14%);
  --channel-hover: hsl(0 0% 100% / 0.05);
  --channel-active: hsl(0 0% 100% / 0.10);
  --status-active: hsl(213 92% 65%);
}
```

### Styling rules

- Preserve Chief's near-square geometry. Use modest radius only where it helps
  browser/video containment or native menus.
- Avoid gratuitous gradients, glass cards, colored blobs, and dashboard-card
  mosaics.
- Use shadows only to explain z-order: context menus, floating browser mode,
  and the light-mode content/sidebar separation.
- Prefer opacity and token shifts over new colors.
- Keep body text in Geist; reserve Geist Pixel for wordmark, empty-state title,
  and major landing-page moments.
- Keep transcript body at 14–15px with 1.55–1.7 line height.
- Hit targets are at least 32px desktop and 44px touch surfaces.
- Every hover-only action must also appear on keyboard focus.
- Respect reduced motion.

### Content panel treatment

The main workspace panel should feel like a continuous native surface:

- sidebar background extends edge to edge;
- content surface begins beside it with a quiet border;
- light mode may use a subtle 4px soft separation shadow;
- dark mode uses border/contrast rather than a bright shadow;
- the transcript, header, and composer share one background plane;
- browser/artifact frames create local contrast only when present.

## Domain model

The target domain should be transport-neutral.

```ts
interface ChiefChannel {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  purpose?: string;
  kind: "workspace" | "direct" | "private";
  visibility: "workspace" | "members";
  memberIds: string[];
  agentIds: ChiefAgentId[];
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface ChiefMessage {
  id: string;
  channelId: string;
  author: { kind: "human" | "agent" | "system"; id: string };
  content: MessageContent[];
  replyToId?: string;
  artifactIds: string[];
  browserSessionIds: string[];
  createdAt: number;
  editedAt?: number;
}

interface ChiefBrowserSessionProjection {
  id: string;
  channelId: string;
  messageId: string;
  status: "preparing" | "operating" | "waiting" | "complete" | "failed";
  visibility: "owner" | "channel";
  activeAgentId?: ChiefAgentId;
  startedAt: number;
  completedAt?: number;
  recordingArtifactId?: string;
}
```

### Legacy compatibility

The first desktop vertical slice may project each current root chat as a
channel-like row. The compatibility layer should be explicit:

```ts
function chatToChannelSummary(chat: LocalChatSummary): ChannelSummary {
  return {
    id: chat.id,
    name: chat.title || "New conversation",
    kind: integrationSetupDomainFromChat(chat.id) ? "private" : "workspace",
    running: chat.running,
    updatedAt: chat.updatedAt,
  };
}
```

Do not bake title heuristics into the final channel model. They are a migration
bridge only.

## Nostr assessment

Nostr is a plausible transport for external channel projections because it
offers signed identities, relays, mentions, membership/event patterns, and a
model already exercised by Buzz.

Use it only behind a `ChannelTransport` boundary:

```ts
interface ChannelTransport {
  subscribe(channelIds: string[], after?: string): AsyncIterable<ChannelEvent>;
  publish(command: PublishChannelCommand): Promise<PublishedChannelEvent>;
  syncMembership(channelId: string): Promise<ChannelMembershipSnapshot>;
}
```

Desktop can start with a Chief/Convex or local transport. A later Nostr adapter
maps canonical Chief events to signed relay events. The UI never branches on
Nostr.

Nostr must not carry:

- provider secrets;
- browser frames or raw stream credentials;
- local file paths;
- Executor bearer tokens;
- hidden prompts or private specialist traces;
- control-lease heartbeats.

## Performance requirements

- Channel selection should show cached content immediately and revalidate in
  place.
- Avoid request waterfalls: load channel metadata, transcript, artifact
  summaries, and presence concurrently when independent.
- Virtualize or use `content-visibility` once timelines exceed the current
  bounded transcript assumptions.
- Subscribe to derived booleans (`isRunning`, `hasUnread`) rather than broad
  runtime state where practical.
- Memoize expensive message-group derivation and artifact projections.
- Dynamically load heavy artifact/browser presentation code only when present.
- One browser viewport owns one WebSocket/input boundary.
- Do not remount the active browser frame when toggling display modes.

## Accessibility requirements

- All sidebar rows, headings, menus, and composer controls are keyboard
  reachable.
- Selected channel uses `aria-current` or equivalent.
- Running/unread states are not color-only.
- Context-menu commands have matching keyboard-accessible entry points.
- Agent activity overlays do not block assistive technology or pointer input.
- Browser takeover is an explicit labelled control.
- Light and dark modes meet WCAG AA for ordinary text and controls.
- Reduced-motion users receive stable state changes without shimmer or travel.

## Implementation sequence

### Phase 0 — research and PRD

- [x] Inspect current Chief shell, conversations, onboarding, runtime, and
  browser panel.
- [x] Inspect Buzz sidebar, channel, context-menu, theme, and content-surface
  source/tests.
- [x] Inspect published `@browser-ui/react` API and local repository.
- [x] Inspect Executor 1.5.37 artifact architecture and UI.
- [x] Write this PRD before product implementation.

### Phase 1 — authored shell and themes

- [ ] Add theme provider with System, Light, and Dark.
- [ ] Replace the icon rail in the authenticated workspace with a continuous
  channel sidebar.
- [ ] Add grouped/collapsible headings and channel-like root chat projection.
- [ ] Add honest right-click channel actions.
- [ ] Preserve Overview as the branded home surface.
- [ ] Keep settings, integrations, schedule, and agents reachable.

### Phase 2 — channel conversation treatment

- [ ] Add compact channel header and purpose/agent presence.
- [ ] Convert user/agent content from chatbot bubbles to speaker-grouped team
  timeline styling.
- [ ] Refine composer identity and advanced execution controls.
- [ ] Preserve integration setup, approvals, questions, and recurring-work
  composers.

### Phase 3 — Browser UI dogfood

- [ ] Install `@browser-ui/react` from npm.
- [ ] Replace the bespoke Chief browser viewport/overlay composition.
- [ ] Add picture-in-picture and fullscreen without remounting the stream.
- [ ] Keep Chief host navigation/reload/close actions.
- [ ] Verify agent-operating, waiting-for-human, and close states.

### Phase 4 — Executor artifacts entry point

- [ ] Upgrade Chief's Executor dependency from 1.5.34 to 1.5.37.
- [ ] Ensure the Chief MCP session receives the default artifact surface.
- [ ] Add a Work / Artifacts destination that can project Executor artifact
  summaries without copying the renderer.
- [ ] Attach created/shown artifact results to the originating conversation.
- [ ] Document which legacy pages are candidates for convergence, with no
  destructive migration in this branch.

### Phase 5 — QA and iteration

- [ ] Add component/unit tests for section state, channel projection, context
  actions, and theme persistence.
- [ ] Run desktop test, lint, format, typecheck, and build.
- [ ] Start the Tauri development app.
- [ ] Inspect the real window in light and dark modes.
- [ ] Exercise channel switching, right-click actions, scrolling, empty/new
  channel, long transcript, running agent, browser open/control/close, and
  narrow window states.
- [ ] Correct visual or interaction defects before committing.

## Acceptance criteria for this branch

1. The branch is named `feat/channel-ux` and is not pushed.
2. Onboarding and unauthenticated/landing flows remain intact.
3. Post-onboarding Chief opens into a cohesive workspace shell with a grouped
   channel sidebar rather than an icon-only feature rail.
4. Existing conversations remain available and functional.
5. At least one channel row has a polished right-click menu with truthful
   actions.
6. Light, dark, and system appearance are available and persist.
7. The main conversation reads as a team channel, not a customer-support bot.
8. `@browser-ui/react` is installed from npm and used for the live browser
   surface.
9. Browser inline, picture-in-picture, fullscreen, agent-operating, and close
   paths are represented by first-party Browser UI primitives.
10. Chief depends on the latest studied Executor artifact release and contains
    a clear, non-destructive artifact integration seam.
11. No UI exposes Nostr, MCP Apps, relay, or Executor implementation jargon in
    normal use.
12. Relevant tests, typechecking, linting, formatting, and the production build
    pass.
13. The work is visually verified in the Tauri development application.
14. Focused local commits are created with one-sentence commit messages and no
    coauthoring mention.

## Open decisions intentionally deferred

- Whether canonical channel storage should begin in Convex or a new shared
  control-plane package before external transports are added.
- Whether desktop direct messages to agents are separate channels or filtered
  views of HQ work.
- Whether every live browser session should automatically record a durable
  playback artifact.
- Which legacy domain views graduate into curated artifact indexes versus
  remain dedicated tools.
- Whether a Nostr transport is required for the first non-Buzz external
  surface or a Slack-specific adapter proves the canonical model first.

These decisions do not block the initial channel workspace, authored themes,
Browser UI dogfood, or Executor artifact seam.

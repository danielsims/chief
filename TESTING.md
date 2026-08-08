# Testing Chief as a native desktop app

This guide describes the development loop for testing the real Tauri desktop
application rather than the Vite page at `http://localhost:1420`.

## Why this matters

The localhost page is only the React webview source. It cannot exercise native
Tauri APIs such as the opener, deep links, notifications, sidecars, or the
desktop authentication bridge. End-to-end review must target the running Chief
window and correlate what is visible there with the agent-runtime log.

The useful loop is:

1. Build or edit the implementation.
2. Let Vite or the runtime watcher reload it.
3. Find and capture the native Chief window.
4. Drive controls through macOS Accessibility.
5. Capture the window again after every meaningful transition.
6. Read the matching runtime log entries.
7. Fix a confirmed failure, run focused tests, and repeat the same UI path.

## Start the development app

Run:

```sh
pnpm desktop:dev
```

This starts the Vite renderer, the Tauri debug application, and the agent
runtime watcher. In development, the native process is usually named `desktop`
and its window title is `Chief`.

The primary runtime log is:

```text
/tmp/chief-agent-runtime.log
```

Record the log byte offset or timestamp before beginning a scenario. This keeps
old failures from being mistaken for failures from the current run.

## Find the native window

Do not assume the window is on the currently visible display or Space. A Chief
window can be running at negative global coordinates on another display.

macOS exposes the window through Core Graphics even when it is not in the
foreground. The following Swift snippet lists Chief windows and their temporary
window IDs:

```sh
swift -e 'import CoreGraphics
let rows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
for row in rows {
  let owner = row[kCGWindowOwnerName as String] as? String ?? ""
  let name = row[kCGWindowName as String] as? String ?? ""
  if owner.lowercased() == "desktop" && name == "Chief" {
    print(row[kCGWindowNumber as String] ?? "")
  }
}'
```

Window IDs are ephemeral. Resolve the ID again after restarting Tauri.

## Capture only the Chief window

Once the ID is known, capture the native window without exposing unrelated
windows on the desktop:

```sh
screencapture -x -l WINDOW_ID /tmp/chief-native-window.png
```

Inspect that image as the visual source of truth. Prefer a window capture over
a full-screen capture because the latter can include unrelated private content.

## Interact through Accessibility

Bring the native process forward before querying its accessibility tree:

```applescript
tell application "System Events"
  tell application process "desktop"
    set frontmost to true
  end tell
end tell
```

Controls inside the Tauri webview are exposed as accessibility elements. Find
them by stable visible name and semantic role, then press the unique match. For
example, a sidebar link can be activated with `AXPress` after verifying there
is exactly one matching `AXLink`.

Important rules:

- Capture first; never click guessed screen coordinates.
- Match both name and role when labels may repeat as static text.
- Treat zero or multiple matches as a failed locator and inspect again.
- After every action, recapture the window before deciding what to do next.
- Prefer reversible navigation and form input. Do not send messages, delete
  data, connect accounts, or approve external changes unless the scenario
  explicitly calls for it.
- The macOS Accessibility permission must be enabled for the process running
  the test.

## Correlate the UI with runtime events

For onboarding and channel work, inspect new lines from
`/tmp/chief-agent-runtime.log` alongside each screenshot. Useful signals
include:

- `[chief] preparing getting-started channel`
- `[chief] getting-started channel prepared`
- session `init`, `status`, `message`, `result`, and `exit` events
- specialist session creation and delegation IDs
- browser open/broadcast events and their anchor message IDs
- runtime restarts, uncaught exceptions, reconnects, and duplicate sessions

The UI and log must agree. A welcome message alone does not prove the kickoff
completed, a status event does not prove a message rendered, and a specialist
session starting does not prove its result reached `#getting-started`.

## Full onboarding regression scenario

Use the Chief workspace's **Restart onboarding** setting. This intentionally
keeps the saved answers, making the scenario repeatable without creating a new
workspace.

1. Record the log start position.
2. Open **Settings** and choose **Restart onboarding**.
3. Click through every step with the saved values, capturing meaningful state
   transitions and noting any skipped, blocked, duplicated, or stale step.
4. Finish onboarding and open `#getting-started` immediately.
5. Observe the channel until the root Chief turn and delegated specialist work
   settle.
6. Verify message order, incremental streaming, status/activity cards, browser
   attachments, failure and retry states, and whether completed specialist
   output returns to the visible conversation.
7. Compare every visible transition with the log slice from this run.
8. Turn each confirmed failure into a focused automated test where practical,
   implement the smallest durable fix, and repeat the native flow.

## Evidence to retain

For a meaningful regression run, keep:

- before/after native-window screenshots for each failure;
- the exact fresh log slice for the scenario;
- workspace ID, channel ID, root session ID, specialist session IDs, and stable
  delegation IDs;
- the expected and actual visible message sequence;
- the focused test command and result after the fix.

Temporary screenshots and log excerpts should stay outside the repository
unless they are deliberately curated as non-sensitive fixtures.

/**
 * The few browser pages in the GitHub connection. They borrow Chief's own
 * look (Geist, its palette, the relay connection illustration) so leaving the
 * app for GitHub never feels like landing somewhere else.
 */

const CHIEF_MARK = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M29 12H12V29M35 12h17v12M29 52H12V35M35 52h17V40" stroke="currentColor" stroke-width="6"/></svg>`;

const GITHUB_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

const STYLES = `
:root {
  color-scheme: light dark;
  --background: hsl(0 0% 100%); --foreground: hsl(0 0% 7%);
  --muted: hsl(0 0% 40%); --border: hsl(42 6% 85%);
  --tile: hsl(42 16% 96%); --primary: hsl(240 6% 10%); --primary-foreground: hsl(0 0% 98%);
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: hsl(0 0% 5%); --foreground: hsl(0 0% 98%);
    --muted: hsl(0 0% 60%); --border: hsl(0 0% 15%);
    --tile: hsl(0 0% 9%); --primary: hsl(0 0% 98%); --primary-foreground: hsl(240 6% 10%);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
  background: var(--background); color: var(--foreground);
  font: 400 14px/1.5 "Geist", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
}
main { width: 100%; max-width: 360px; text-align: center; }
.connection { display: flex; align-items: center; justify-content: center; }
.tile { position: relative; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 16px; border: 1px solid var(--border); background: var(--background); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.tile svg { width: 24px; height: 24px; }
.link { position: relative; width: 80px; display: flex; align-items: center; justify-content: center; }
.link::before { content: ""; position: absolute; inset: 50% 0 auto; border-top: 1px dashed var(--muted); opacity: .45; }
.link span { position: relative; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--muted); background: var(--background); }
.done .link::before { border-top-style: solid; }
.done .link span { background: var(--foreground); border-color: var(--foreground); }
h1 { margin: 24px 0 0; font-size: 20px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.3; }
p { margin: 6px 0 0; color: var(--muted); }
button {
  margin-top: 24px; height: 36px; padding: 0 14px; border: 0; border-radius: 8px;
  background: var(--primary); color: var(--primary-foreground);
  font: 500 14px/1 "Geist", system-ui, sans-serif; cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--muted); outline-offset: 2px; }
`;

function escape(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function document(title: string, body: string, connected: boolean) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)} · Chief</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&display=swap" />
<style>${STYLES}</style>
</head>
<body>
<main>
  <div class="connection${connected ? " done" : ""}" aria-hidden="true">
    <div class="tile">${CHIEF_MARK}</div>
    <div class="link"><span></span></div>
    <div class="tile">${GITHUB_MARK}</div>
  </div>
  ${body}
</main>
</body>
</html>`;
}

function page(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
    },
  });
}

/** A result page: connected, updated, or what went wrong. */
export function githubPage(input: {
  title: string;
  detail?: string;
  status?: number;
}) {
  const failed = (input.status ?? 200) >= 400;
  const detail =
    input.detail ?? "Head back to Chief to choose your repositories.";
  return page(
    document(
      input.title,
      `<h1>${escape(input.title)}</h1><p>${escape(detail)}</p>`,
      !failed,
    ),
    input.status,
  );
}

/**
 * Hands the manifest to GitHub, which shows the app it is about to create.
 * It submits itself; the button only matters without JavaScript.
 */
export function githubSetupPage(input: {
  name: string;
  origin: string;
  state: string;
}) {
  const manifest = JSON.stringify({
    name: input.name,
    url: input.origin,
    description: "Gives Chief agents access to the repositories you choose.",
    public: false,
    redirect_url: `${input.origin}/github/setup/callback`,
    callback_urls: [`${input.origin}/github/installed`],
    request_oauth_on_install: true,
    setup_on_update: false,
    hook_attributes: { url: `${input.origin}/github/webhook`, active: false },
    default_permissions: {
      contents: "write",
      metadata: "read",
      pull_requests: "write",
    },
    default_events: [],
  });
  const action = `https://github.com/settings/apps/new?state=${encodeURIComponent(input.state)}`;
  return page(
    document(
      "Opening GitHub",
      `<h1>Opening GitHub</h1>
<form id="manifest" method="post" action="${escape(action)}">
  <input type="hidden" name="manifest" value="${escape(manifest)}" />
  <noscript><button type="submit">Continue to GitHub</button></noscript>
</form>
<script>document.getElementById("manifest").submit();</script>`,
      false,
    ),
  );
}

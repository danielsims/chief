/**
 * The few browser pages in Chief's connection flows. They borrow Chief's own
 * look (Geist, its palette, the relay connection illustration) so leaving the
 * app for a provider never feels like landing somewhere else.
 */

const CHIEF_MARK = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M29 12H19a7 7 0 0 0-7 7v10M35 12h10a7 7 0 0 1 7 7v5M29 52H19a7 7 0 0 1-7-7V35M35 52h10a7 7 0 0 0 7-7v-5" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round"/></svg>`;

const STYLES = `
:root {
  color-scheme: light dark;
  --background: hsl(0 0% 100%); --foreground: hsl(0 0% 7%);
  --muted: hsl(0 0% 40%); --border: hsl(42 6% 85%);
  --tile: hsl(42 16% 96%);
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: hsl(0 0% 5%); --foreground: hsl(0 0% 98%);
    --muted: hsl(0 0% 60%); --border: hsl(0 0% 15%);
    --tile: hsl(0 0% 9%);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 64px 16px;
  background: var(--background); color: var(--foreground);
  font: 400 14px/1.5 "Geist", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
}
main {
  width: 100%; max-width: 420px; padding: 32px; text-align: center;
  background: var(--tile); border-radius: 16px;
  box-shadow: 0 0 0 1px var(--border), 0 12px 32px -16px rgba(0,0,0,.35);
}
.connection { display: flex; align-items: center; justify-content: center; margin-bottom: 36px; }
.tile { position: relative; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px; border: 1px solid var(--border); background: var(--background); box-shadow: 0 1px 2px rgba(0,0,0,.06); overflow: hidden; }
.tile svg { width: 24px; height: 24px; }
.tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: var(--background); }
.link { position: relative; width: 56px; display: flex; align-items: center; justify-content: center; }
.link::before { content: ""; position: absolute; inset: 50% 0 auto; border-top: 1px dashed var(--muted); opacity: .45; }
.link span { position: relative; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--muted); background: var(--background); }
.done .link::before { border-top-style: solid; }
.done .link span { background: var(--foreground); border-color: var(--foreground); }
h1 { margin: 0; font-size: 21px; font-weight: 550; letter-spacing: -.035em; line-height: 1.25; }
p { margin: 10px 0 0; color: var(--muted); line-height: 1.625; overflow-wrap: anywhere; }
strong { color: var(--foreground); font-weight: 500; }
button, .button {
  display: flex; align-items: center; justify-content: center; text-decoration: none;
  width: 100%; min-height: 39px; margin-top: 28px; padding: 10px 14px; border: 0; border-radius: 8px;
  background: var(--foreground); color: var(--background);
  font: 500 14px/1.4 "Geist", system-ui, sans-serif; cursor: pointer; transition: opacity .15s;
}
button:hover, .button:hover { opacity: .9; }
button:focus-visible, .button:focus-visible { outline: 2px solid var(--muted); outline-offset: 2px; }

`;

export function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

/** Chief and the service it is connecting to, side by side. */
export function connectionDocument(
  title: string,
  body: string,
  connected: boolean,
  serviceMark: string,
) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · Chief</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;550&display=swap" />
<style>${STYLES}</style>
</head>
<body>
<main>
  <div class="connection${connected ? " done" : ""}" aria-hidden="true">
    <div class="tile">${CHIEF_MARK}</div>
    <div class="link"><span></span></div>
    <div class="tile">${serviceMark}</div>
  </div>
  ${body}
</main>
</body>
</html>`;
}

export function htmlPage(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      // These pages confirm connections, so no other site may frame them.
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
    },
  });
}

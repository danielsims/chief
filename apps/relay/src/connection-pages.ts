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
.tile { overflow: hidden; }
.tile svg { width: 24px; height: 24px; }
.tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: var(--background); }
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&display=swap" />
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

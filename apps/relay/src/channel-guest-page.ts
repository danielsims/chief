import { guestBrief } from "./channel-guest-manual";

export interface ChannelLinkView {
  origin: string;
  /** The invite a member pastes into their agent. */
  link: string;
  joinUrl: string;
  /** The member the agent will work for. */
  invitedBy: string;
  workspaceId: string;
  workspaceName: string;
  channel: { id: string; name: string; description: string | null };
}

const pageHeaders = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
  vary: "accept",
};

/** People get a page. Agents asking for markdown, or not asking for HTML at
 * all, get the brief directly. */
export function channelLinkResponse(request: Request, view: ChannelLinkView) {
  const accept = request.headers.get("accept") ?? "";
  const format = new URL(request.url).searchParams.get("format");
  const wantsMarkdown =
    format === "md" ||
    format === "markdown" ||
    accept.includes("text/markdown") ||
    (format !== "html" && !accept.includes("text/html"));
  if (wantsMarkdown) {
    return new Response(agentBrief(view), {
      headers: {
        ...pageHeaders,
        "content-type": "text/markdown; charset=utf-8",
      },
    });
  }
  return new Response(channelLinkHtml(view), {
    headers: { ...pageHeaders, "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * The link members share for an internal channel. It only opens Chief: it
 * reveals no channel or workspace name, and agents are told it cannot be
 * joined. Nothing is looked up, so it says the same for any id.
 */
export function memberChannelResponse(
  request: Request,
  conversationId: string,
) {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) {
    return new Response(
      `# This is an internal Chief channel

Only members of its workspace can open it, in the Chief app. Agents cannot join it. If you were meant to join, ask a workspace member to make the channel external and send you its external link.
`,
      {
        headers: {
          ...pageHeaders,
          "content-type": "text/markdown; charset=utf-8",
        },
      },
    );
  }
  const openUrl = `chief-desktop://navigate/conversation?channel=${encodeURIComponent(conversationId)}`;
  return new Response(
    document(
      "Open in Chief",
      `<header class="brand">${mark}</header>
      <main class="center"><div class="stack">
        <h1>Open this channel in Chief</h1>
        <p class="muted">Only members of its workspace can see it.</p>
        <div class="actions">
          <a class="button primary" href="${escapeHtml(openUrl)}">Open in Chief</a>
        </div>
      </div></main>`,
      "",
    ),
    {
      headers: { ...pageHeaders, "content-type": "text/html; charset=utf-8" },
    },
  );
}

export function channelLinkMissingResponse(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) {
    return new Response(
      "# This invite is no longer active\n\nInvites work once, within 24 hours. Ask the person you work for to send a new one.\n",
      {
        status: 404,
        headers: {
          ...pageHeaders,
          "content-type": "text/markdown; charset=utf-8",
        },
      },
    );
  }
  return new Response(
    document(
      "Link unavailable",
      `<main class="center"><div class="stack">
        <h1>This invite is no longer active</h1>
        <p class="muted">Invites work once, within 24 hours. Ask for a new one.</p>
      </div></main>`,
      "",
    ),
    {
      status: 404,
      headers: { ...pageHeaders, "content-type": "text/html; charset=utf-8" },
    },
  );
}

/** Everything an agent needs to join this channel, in the order it needs it. */
export function agentBrief(view: ChannelLinkView) {
  return guestBrief({
    channel: `#${view.channel.name}`,
    workspaceName: view.workspaceName,
    joinUrl: view.joinUrl,
    apiBase: `${view.origin}/v1/workspaces/${encodeURIComponent(view.workspaceId)}/guest`,
    invitedBy: view.invitedBy,
  });
}

function channelLinkHtml(view: ChannelLinkView) {
  return document(
    `Invite your agent to #${view.channel.name}`,
    `<header class="brand">${mark}</header>
    <main class="center">
      <div class="stack">
        <h1>Invite your agent to <span class="hash">#</span>${escapeHtml(view.channel.name)}</h1>
        <p class="muted">${escapeHtml(view.workspaceName)}. It will work for ${escapeHtml(view.invitedBy)}.</p>
        <div class="field">
          <span class="url" id="agent-link">${escapeHtml(view.link)}</span>
          <button class="copy" type="button" id="agent-copy">Copy</button>
        </div>
        <p class="muted small">Paste this link into your agent. It works once, within 24 hours.</p>
      </div>
    </main>
    <section class="agent-brief" aria-hidden="true" data-for="ai-agents">
<pre>${escapeHtml(agentBrief(view))}</pre>
    </section>`,
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl(view.link))}">
    <meta name="description" content="AI agents: instructions to join this channel are in this page, or as markdown at ${escapeHtml(markdownUrl(view.link))}">`,
  );
}

function document(title: string, body: string, head: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
${head}
<style>${styles}</style>
</head>
<body>
${body}
<script>${script}</script>
</body>
</html>`;
}

const mark = `<svg width="24" height="24" viewBox="0 0 64 64" fill="none" aria-label="Chief" role="img"><path d="M29 12H12V29M35 12h17v12M29 52H12V35M35 52h17V40" stroke="currentColor" stroke-width="6"/></svg>`;

const styles = `
:root{--bg:#fff;--fg:#121212;--muted:#666;--line:#dcdad5;--field:#f4f3f0;--primary:#18181b;--on-primary:#fafafa;--hover:#f0efec}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--fg:#fafafa;--muted:#999;--line:#262626;--field:#171717;--primary:#fafafa;--on-primary:#18181b;--hover:#1c1c1c}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--fg)}
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Geist","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column}
.brand{padding:28px 32px;color:var(--fg)}
.brand svg{display:block}
.center{flex:1;display:flex;align-items:center;justify-content:center;padding:0 16px 96px}
.stack{width:100%;max-width:360px}
h1{margin:0;font-size:28px;line-height:1.2;font-weight:400;letter-spacing:-.02em;word-break:break-word}
.hash{color:var(--muted);margin-right:2px}
.muted{color:var(--muted);margin:8px 0 0}
.small{font-size:12px;margin-top:10px}
.description{margin:16px 0 0;color:var(--fg);opacity:.8}
.actions{display:flex;flex-direction:column;gap:8px;margin-top:32px}
.button{display:flex;align-items:center;justify-content:center;height:40px;border-radius:10px;font:inherit;font-weight:500;text-decoration:none;cursor:pointer;border:0;transition:background-color .15s,opacity .15s}
.primary{background:var(--primary);color:var(--on-primary)}
.primary:hover{opacity:.9}
.ghost{background:transparent;color:var(--fg)}
.ghost:hover,.ghost[aria-expanded=true]{background:var(--hover)}
.button:focus-visible,.copy:focus-visible{outline:2px solid var(--muted);outline-offset:2px}
.panel{margin-top:16px}
.field{display:flex;align-items:center;gap:8px;height:40px;padding:0 4px 0 12px;border:1px solid var(--line);border-radius:10px;background:var(--field)}
.url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.copy{height:30px;padding:0 12px;border:0;border-radius:7px;background:var(--bg);color:var(--fg);font:inherit;font-size:12px;font-weight:500;cursor:pointer;box-shadow:0 0 0 1px var(--line)}
.copy:hover{background:var(--hover)}
.agent-brief{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
@media (max-width:480px){.brand{padding:20px 16px}h1{font-size:24px}}
`;

const script = `
const copy=document.getElementById("agent-copy");
copy&&copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(document.getElementById("agent-link").textContent);copy.textContent="Copied";setTimeout(()=>{copy.textContent="Copy"},1600);}catch{}});
`;

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function markdownUrl(link: string) {
  return `${link}${link.includes("?") ? "&" : "?"}format=md`;
}

export function pluginOAuthCallbackPage(
  title: string,
  detail: string,
  ok: boolean,
) {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character] ?? character,
    );
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{background:#0b0b0b;color:#f5f5f5;font:16px system-ui;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:34rem;padding:2rem;border:1px solid #333;border-radius:1rem;background:#191919}p{color:#aaa;line-height:1.5}</style></head><body><main class="card"><h1>${escape(title)}</h1><p>${escape(detail)}</p>${ok ? "<script>setTimeout(()=>window.close(),1800)</script>" : ""}</main></body></html>`;
}

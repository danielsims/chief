export function relayDocsHtml(openApiUrl: string) {
  const escaped = openApiUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chief Relay API</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { max-width: 760px; margin: 0 auto; padding: 64px 24px; background: #0b0b0b; color: #f5f5f5; }
      h1 { font-size: 32px; letter-spacing: -0.03em; }
      p { color: #aaa; line-height: 1.6; }
      a { color: #67e8f9; }
      code { background: #191919; border: 1px solid #2b2b2b; border-radius: 6px; padding: 3px 6px; }
    </style>
  </head>
  <body>
    <h1>Chief Relay API</h1>
    <p>The versioned protocol for Chief workspaces, clients, and durable agents.</p>
    <p><a href="${escaped}">OpenAPI 3.1 document</a></p>
    <p>All mutations use client-generated command IDs and persist before they are published.</p>
  </body>
</html>`;
}

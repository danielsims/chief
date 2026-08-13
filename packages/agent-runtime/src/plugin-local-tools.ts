export interface PluginLocalToolService {
  list: (force?: boolean) => Promise<unknown>;
  install: (pluginId: string, trusted: boolean) => Promise<unknown>;
  authorize: (pluginId: string) => Promise<unknown>;
  uninstall: (pluginId: string) => Promise<unknown>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function pluginSearchResults(snapshot: unknown, url: URL) {
  const result = snapshot as { plugins?: unknown[] } & Record<string, unknown>;
  const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
  const requestedLimit = Number(url.searchParams.get("limit") ?? 8);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(20, Math.floor(requestedLimit)))
    : 8;
  const candidates = Array.isArray(result.plugins) ? result.plugins : [];
  const plugins = query
    ? candidates.filter(
        (plugin) =>
          plugin &&
          typeof plugin === "object" &&
          ["name", "description", "category", "id"].some((key) => {
            const value = (plugin as Record<string, unknown>)[key];
            return (
              typeof value === "string" && value.toLowerCase().includes(query)
            );
          }),
      )
    : candidates;
  return {
    ...result,
    plugins: plugins.slice(0, limit),
    total: plugins.length,
    query: query || undefined,
  };
}

/** Handles the portable plugin endpoints exposed to local agent tools. */
export async function handlePluginLocalTool(
  request: Request,
  body: Record<string, unknown>,
  service?: PluginLocalToolService,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname;
  const match =
    /^\/local-tools\/plugins\/([^/]+)(?:\/(install|authorize))?$/.exec(path);
  if (path === "/local-tools/plugins" && request.method === "GET") {
    if (!service) return json({ error: "Plugin service is unavailable." }, 503);
    return json(
      pluginSearchResults(
        await service.list(url.searchParams.get("refresh") === "true"),
        url,
      ),
    );
  }
  if (!match || !service) return undefined;
  const pluginId = decodeURIComponent(match[1] ?? "");
  const action = match[2];
  try {
    if (request.method === "POST" && action === "install") {
      return json(await service.install(pluginId, body.trusted === true));
    }
    if (request.method === "POST" && action === "authorize") {
      return json(await service.authorize(pluginId));
    }
    if (request.method === "DELETE" && !action) {
      return json(await service.uninstall(pluginId));
    }
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
  return undefined;
}

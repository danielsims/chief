import { z } from "zod";

import { callMcpTool } from "../mcp/client";

/**
 * Exa's hosted MCP server answers without an account, so search works on a
 * free self-hosted relay with nothing to pay for or configure. An operator's
 * EXA_API_KEY only raises the rate limit.
 */
const exaMcpUrl = "https://mcp.exa.ai/mcp";
const maxTextLength = 16_000;

type ExaEnv = Pick<Env, "EXA_API_KEY" | "RELAY_PUBLIC_URL" | "AUTH_BASE_URL">;

const textContentSchema = z.array(
  z.looseObject({ type: z.string(), text: z.string().optional() }),
);

async function callExa(
  env: ExaEnv,
  tool: string,
  args: Record<string, string | number | string[]>,
) {
  const key = env.EXA_API_KEY?.trim();
  const result = await callMcpTool(
    {
      url: exaMcpUrl,
      ...(key ? { headers: [{ name: "x-api-key", value: key }] } : undefined),
      limits: {
        relayHost: new URL(env.RELAY_PUBLIC_URL ?? env.AUTH_BASE_URL).hostname,
        maxBytes: 512_000,
        timeoutMs: 30_000,
      },
    },
    tool,
    args,
  );
  const content = textContentSchema.safeParse(result.content);
  const text = content.success
    ? content.data
        .flatMap((part) => (part.text ? [part.text] : []))
        .join("\n\n")
    : "";
  if (result.isError || !text.trim())
    throw new Error(text.trim().slice(0, 300) || "Exa returned no results.");
  return text.slice(0, maxTextLength);
}

export async function exaSearch(env: ExaEnv, query: string) {
  const text = await callExa(env, "web_search_exa", {
    query,
    objective: query,
    numResults: 8,
  });
  return { engine: "exa", status: "loaded", query, text };
}

export async function exaRead(env: ExaEnv, url: string) {
  const text = await callExa(env, "web_fetch_exa", { urls: [url] });
  return { url, title: "", text, links: [] };
}

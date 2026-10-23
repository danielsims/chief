import { getDomain, parse } from "tldts";

/**
 * Every request Chief makes to a remote MCP server or its authorization server
 * goes through here. The URLs come from workspace admins and from metadata the
 * remote server publishes, so none of them are trusted:
 *
 *  - HTTPS on the default port to a public hostname only. No credentials in
 *    the URL, no IP literals, no single-label or internal names, and never the
 *    relay itself.
 *  - Redirects are followed by hand so each hop is checked again. Only reads
 *    follow redirects; a redirected POST could replay a token request elsewhere.
 *  - Every request has a deadline and every response a size limit, including
 *    streamed MCP responses.
 */
const maximumRedirects = 3;

/**
 * The registrable domain ("site") of a hostname, from the Public Suffix List
 * including private suffixes, so two sites on vercel.app or github.io never
 * count as one.
 */
export function siteOf(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.+$/u, "");
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

function publicName(hostname: string) {
  const parsed = parse(hostname, { allowPrivateDomains: true });
  return Boolean(
    parsed.domain && (parsed.isIcann === true || parsed.isPrivate === true),
  );
}

export class McpFetchError extends Error {}

export interface McpFetchLimits {
  /** Hostname of the relay, which a remote server must never point Chief at. */
  relayHost: string;
  maxBytes: number;
  timeoutMs: number;
}

export function requirePublicMcpUrl(value: string | URL, relayHost: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpFetchError("The server address is not a valid URL.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/u, "");
  const relay = relayHost.toLowerCase();
  // The relay's own zone and Cloudflare's worker names could reach Chief's
  // other services, so neither is a plugin.
  const relayZone = siteOf(relay);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "443") ||
    !hostname.includes(".") ||
    hostname.split(".").some((label) => label === "") ||
    // Only names under a real public suffix: .local, .internal, .corp and
    // other private names are refused without anyone keeping a list.
    !publicName(hostname) ||
    hostname.startsWith("[") ||
    // WHATWG URL parsing normalises every IPv4 spelling to dotted decimal.
    /^\d{1,3}(\.\d{1,3}){3}$/u.test(hostname) ||
    hostname === relay ||
    hostname === relayZone ||
    hostname.endsWith(`.${relayZone}`) ||
    hostname.endsWith(".workers.dev")
  ) {
    throw new McpFetchError(
      "Plugins must use a public HTTPS address on the default port.",
    );
  }
  return url;
}

function deadline(signal: AbortSignal | null | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function limitBody(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    throw new McpFetchError("The plugin sent a response that is too large.");
  }
  if (!response.body) return response;
  let received = 0;
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          controller.error(
            new McpFetchError("The plugin sent a response that is too large."),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(counted, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function neutralHeaders(headers: Headers) {
  const kept = new Headers();
  for (const name of ["accept", "mcp-protocol-version", "user-agent"]) {
    const value = headers.get(name);
    if (value) kept.set(name, value);
  }
  return kept;
}

/** A `fetch` for the MCP SDK and Chief's own MCP calls. */
export function guardedMcpFetch(limits: McpFetchLimits) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    let url = requirePublicMcpUrl(request.url, limits.relayHost);
    const method = request.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    const origin = url.origin;
    for (let hop = 0; ; hop += 1) {
      const response = await fetch(url, {
        method,
        // Credentials (bearer tokens, API-key headers) never follow a redirect
        // to another origin.
        headers:
          url.origin === origin
            ? request.headers
            : neutralHeaders(request.headers),
        body,
        redirect: "manual",
        signal: deadline(request.signal, limits.timeoutMs),
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location)
        return limitBody(response, limits.maxBytes);
      void response.body?.cancel();
      if (method !== "GET" || hop >= maximumRedirects)
        throw new McpFetchError(
          "The plugin redirected Chief somewhere it will not follow.",
        );
      url = requirePublicMcpUrl(new URL(location, url), limits.relayHost);
    }
  };
}

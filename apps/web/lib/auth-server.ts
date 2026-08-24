import { env } from "./env";

const forwardedRequestHeaders = new Set([
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
]);

// The server-side Fetch implementation transparently decodes compressed relay
// bodies but retains the original representation headers. Forwarding those
// headers would tell native clients to decode an already-decoded body.
const decodedRepresentationHeaders = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
] as const;

/**
 * Fixed-origin auth proxy. The relay owns Better Auth and its D1 database;
 * this route only keeps browser cookies first-party to heychief.sh. It cannot
 * proxy arbitrary hosts and does not persist account or session state.
 */
export async function proxyRelayAuth(request: Request) {
  const source = new URL(request.url);
  const target = new URL(
    `${source.pathname}${source.search}`,
    env.CHIEF_RELAY_URL,
  );
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (forwardedRequestHeaders.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  }
  headers.set("x-forwarded-host", source.host);
  headers.set("x-forwarded-proto", source.protocol.replace(":", ""));

  const response = await fetch(target, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    redirect: "manual",
  });

  // Better Auth returns its redirect envelope as JSON when the request has
  // traversed the first-party proxy. OAuth authorize is a browser navigation,
  // so translate that envelope back into an HTTP redirect after validating the
  // destination against Chief's registered web and native callback surfaces.
  if (
    source.pathname === "/api/auth/oauth2/authorize" &&
    response.ok &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      redirect?: unknown;
      url?: unknown;
    } | null;
    const destination =
      payload?.redirect === true && typeof payload.url === "string"
        ? safeAuthorizationRedirect(payload.url, source.origin)
        : null;
    if (destination) {
      return new Response(null, {
        status: 302,
        headers: {
          "cache-control": "no-store",
          location: destination,
        },
      });
    }
  }

  const responseHeaders = new Headers(response.headers);
  for (const name of decodedRepresentationHeaders) {
    responseHeaders.delete(name);
  }
  responseHeaders.set("cache-control", "no-store");

  // Materialize the already-decoded auth payload. On hosted runtimes the
  // upstream ReadableStream can retain compression metadata even after the
  // public headers are sanitized, causing the edge to re-emit a stale `br`
  // marker around plain JSON.
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function safeAuthorizationRedirect(value: string, webOrigin: string) {
  try {
    const destination = new URL(value);
    if (destination.protocol === "https:" && destination.origin === webOrigin) {
      return destination.toString();
    }
    if (
      destination.protocol === "chief-desktop:" &&
      destination.host === "" &&
      destination.pathname === "/auth"
    ) {
      return destination.toString();
    }
    if (
      destination.protocol === "chief-mobile:" &&
      destination.hostname === "auth" &&
      (destination.pathname === "" || destination.pathname === "/")
    ) {
      return destination.toString();
    }
  } catch {
    // Better Auth owns error reporting; an invalid redirect is never followed.
  }
  return null;
}

export const handler = {
  GET: proxyRelayAuth,
  POST: proxyRelayAuth,
};

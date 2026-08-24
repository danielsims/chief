type OAuthIssuerFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function normalizeOAuthIssuer(value: string) {
  const issuer = new URL(value);
  const loopback =
    issuer.hostname === "localhost" || issuer.hostname === "127.0.0.1";
  if (
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    (issuer.protocol !== "https:" &&
      !(issuer.protocol === "http:" && loopback)) ||
    issuer.pathname.replace(/\/+$/u, "") !== "/api/auth"
  ) {
    throw new Error("Chief received an invalid OAuth issuer.");
  }
  issuer.pathname = "/api/auth";
  return issuer.toString().replace(/\/$/u, "");
}

export async function resolveOAuthIssuer(
  authBaseUrl: string,
  fetcher: OAuthIssuerFetch,
) {
  const fallback = normalizeOAuthIssuer(
    new URL("/api/auth", authBaseUrl).toString(),
  );
  try {
    const response = await fetcher(
      new URL("/api/auth/.well-known/openid-configuration", authBaseUrl),
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) return fallback;
    const metadata = (await response.json()) as { issuer?: unknown };
    return typeof metadata.issuer === "string"
      ? normalizeOAuthIssuer(metadata.issuer)
      : fallback;
  } catch {
    return fallback;
  }
}

export async function oauthIssuerMatches(
  responseIssuer: string,
  authBaseUrl: string,
  fetcher: OAuthIssuerFetch,
) {
  try {
    return (
      normalizeOAuthIssuer(responseIssuer) ===
      (await resolveOAuthIssuer(authBaseUrl, fetcher))
    );
  } catch {
    return false;
  }
}

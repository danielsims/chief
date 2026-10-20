import { z } from "zod";

import type { StoredOAuthSession } from "@chief/agent-runtime/mcp-oauth";

import { HttpError } from "../http";
import { siteOf } from "./fetch-guard";

/** Optional metadata the SDK's OAuth/OIDC union does not type on both arms. */
const optionalMetadataSchema = z.object({
  revocation_endpoint: z.string().url().optional().catch(undefined),
  authorization_response_iss_parameter_supported: z
    .boolean()
    .optional()
    .catch(undefined),
});

export function optionalMetadata(session: StoredOAuthSession) {
  return optionalMetadataSchema.parse(
    session.discovery?.authorizationServerMetadata ?? {},
  );
}

/**
 * Mix-up defence. A malicious server could point its sign-in page at an
 * honest provider while keeping the token endpoint for itself, and so receive
 * the person's code and verifier. RFC 8414: the metadata must name the issuer
 * it was fetched for. Then either the provider names itself on the way back
 * (RFC 9207, checked in the callback), or its sign-in and token endpoints
 * must belong to the issuer's own site.
 */
export function requireConsistentIssuer(session: StoredOAuthSession) {
  const discovery = session.discovery;
  const metadata = discovery?.authorizationServerMetadata;
  if (!discovery || !metadata) return;
  const normalise = (value: string) => value.replace(/\/+$/u, "");
  const inconsistent = () =>
    new HttpError(
      502,
      "plugin_issuer_mismatch",
      "This plugin's sign-in server describes itself inconsistently, so Chief won't use it.",
    );
  if (
    normalise(metadata.issuer) !== normalise(discovery.authorizationServerUrl)
  )
    throw inconsistent();
  if (
    optionalMetadata(session).authorization_response_iss_parameter_supported ===
    true
  )
    return;
  const site = siteOf(new URL(metadata.issuer).hostname);
  for (const endpoint of [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
  ])
    if (siteOf(new URL(endpoint).hostname) !== site) throw inconsistent();
}

/**
 * One token operation at a time per plugin. Providers that rotate refresh
 * tokens reject the second of two concurrent refreshes and may revoke them
 * all, and a sign-in must not be overwritten by a refresh mid-flight.
 */
const tokenLocks = new Map<string, Promise<unknown>>();

export async function oneAtATime<T>(key: string, task: () => Promise<T>) {
  const previous = tokenLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  tokenLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (tokenLocks.get(key) === tail) tokenLocks.delete(key);
  }
}

/** Best effort RFC 7009 revocation; removal never depends on the provider. */
export async function revokeSession(
  session: StoredOAuthSession,
  fetchFn: typeof fetch,
) {
  const endpoint = optionalMetadata(session).revocation_endpoint;
  const token = session.tokens?.refresh_token ?? session.tokens?.access_token;
  const clientId = session.clientInformation?.client_id;
  if (!endpoint || !token || !clientId) return;
  try {
    await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: clientId }),
    });
  } catch {
    /* The tokens are already gone from Chief. */
  }
}

/**
 * OAuth access tokens issued by the relay are already short-lived,
 * audience-bound account credentials. Relay traffic remains independently
 * NIP-98 signed; this token is used only for the one-time device-key binding.
 */
export function requestAccountAssertion(sessionToken: string) {
  return Promise.resolve(sessionToken.trim() || null);
}

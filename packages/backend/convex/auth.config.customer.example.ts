/**
 * Example auth.config.ts for a CUSTOMER Convex deployment.
 *
 * Architecture: "hosted identity, sovereign data".
 *
 * - Daniel's CENTRAL Convex deployment (this package, packages/backend) runs
 *   the better-auth component. It is the identity provider: users, sessions,
 *   organizations, and install telemetry all live there. It signs JWTs and
 *   publishes its JWKS at `{AUTH_DOMAIN}/.well-known/jwks.json` (served by the
 *   better-auth convex plugin via the HTTP router).
 *
 * - CUSTOMERS deploy their OWN Convex project for their data. Their deployment
 *   never runs better-auth. Instead it trusts the central auth server as a
 *   standard OIDC-style JWT issuer: Convex validates incoming JWTs against the
 *   central server's JWKS, using the custom provider entry below.
 *
 * To use: copy this file to `convex/auth.config.ts` in the customer project
 * and set the `AUTH_DOMAIN` env var on the customer deployment to the central
 * auth server's site URL (the central deployment's `.convex.site` URL, e.g.
 * `https://<central-deployment>.convex.site`). The `applicationID` must be
 * "convex" — that is the audience the central better-auth convex plugin puts
 * in the JWTs it issues.
 *
 * The JWT payload carries `organizationId` and `sessionId` (see definePayload
 * in convex/auth.ts), so customer deployments can scope data access by org
 * without ever talking to the central database.
 */

export default {
  providers: [
    {
      domain: process.env.AUTH_DOMAIN,
      applicationID: "convex",
    },
  ],
};

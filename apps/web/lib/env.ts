/**
 * Web app environment variables.
 *
 * NEXT_PUBLIC_* vars are inlined at build time by Next.js. Keep access
 * centralized here so the rest of the code imports `env` like the reference.
 */

export const env = {
  /** Central Convex deployment URL (https://<deployment>.convex.cloud) */
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
  /**
   * Convex HTTP actions URL (https://<deployment>.convex.site).
   * Optional — derived from NEXT_PUBLIC_CONVEX_URL when unset.
   */
  NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
};

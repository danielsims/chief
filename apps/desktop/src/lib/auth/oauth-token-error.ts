export class OAuthTokenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Only an explicit client rejection invalidates the durable login. Network
 * failures and server outages preserve the rotating refresh credential so a
 * later foreground refresh can resume the same account securely. */
export function shouldInvalidateOAuthSession(error: unknown) {
  return (
    error instanceof OAuthTokenError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500
  );
}

export interface ChiefAuthOptions {
  apple?: {
    appBundleIdentifier?: string;
    audience?: string | string[];
    clientId: string;
    clientSecret: string;
    redirectURI?: string;
  };
  baseURL: string;
  secret: string;
  uiOrigin: string;
  google?: {
    clientId: string;
    clientSecret: string;
    redirectURI?: string;
  };
  sendOrganizationInvitation?: (invitation: {
    email: string;
    id: string;
    inviter: { email: string; name: string };
    organization: { id: string; name: string };
    role: string | string[];
  }) => Promise<void> | void;
}

/** Native iOS identity tokens use the app bundle as audience; web tokens use
 * the Services ID. Accept both so one Apple provider covers both clients. */
export function appleProviderConfig(
  apple: NonNullable<ChiefAuthOptions["apple"]>,
) {
  return {
    ...apple,
    audience:
      apple.audience ??
      (apple.appBundleIdentifier
        ? [apple.clientId, apple.appBundleIdentifier]
        : undefined),
  };
}

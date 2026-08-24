export interface ChiefAuthOptions {
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

export interface ChiefAuthOptions {
  baseURL: string;
  secret: string;
  uiOrigin: string;
  google?: {
    clientId: string;
    clientSecret: string;
    redirectURI?: string;
  };
}

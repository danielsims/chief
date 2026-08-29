export interface IntegrationSetupResult {
  status: string;
  instruction?: string;
  provider?: string;
  accountName?: string;
  propertyId?: string;
  propertyName?: string;
  properties?: {
    accountName: string;
    propertyId: string;
    propertyName: string;
  }[];
}

export interface IntegrationSetupLocalToolContext {
  googleOAuth?: {
    provisionClient?: (
      sessionId: string,
      attemptId: string,
    ) => Promise<IntegrationSetupResult>;
    captureClient?: (
      sessionId: string,
      attemptId: string,
    ) => Promise<IntegrationSetupResult>;
  };
  googleAnalytics?: {
    startAuthorization: (
      sessionId: string,
      attemptId: string,
    ) => Promise<{ authorizationUrl: string; state: string }>;
    completeAuthorization: (
      sessionId: string,
      attemptId: string,
      state?: string,
    ) => Promise<IntegrationSetupResult>;
    selectProperty: (
      sessionId: string,
      attemptId: string,
      propertyId: string,
    ) => Promise<IntegrationSetupResult>;
  };
  openIntegrationHandoff?: (
    sessionId: string,
    attemptId: string,
    url: string,
  ) => Promise<void>;
  captureGeneratedCredential?: (
    sessionId: string,
    attemptId: string,
  ) => Promise<IntegrationSetupResult>;
  openProviderPage?: (
    sessionId: string,
    attemptId: string,
    url: string,
  ) => Promise<IntegrationSetupResult>;
}

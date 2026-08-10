type RequestBody = ReturnType<(schema: string) => object>;

export function integrationSetupOpenApiPaths(
  body: (schema: string) => RequestBody,
) {
  return {
    "/local-tools/integrations/handoff/open": {
      post: {
        operationId: "integration.openHandoff",
        summary: "Open a secure local connection handoff",
        description:
          "Opens an Executor connection or OAuth-client handoff in Chief's embedded browser with local authentication added by the trusted host. Use only in a user-started integration setup run.",
        requestBody: body("IntegrationHandoffInput"),
        responses: { "200": { description: "Handoff opened" } },
      },
    },
    "/local-tools/integrations/credential/capture": {
      post: {
        operationId: "integration.captureGeneratedCredential",
        summary: "Securely capture a generated provider credential",
        description:
          "Call only while the provider is displaying a newly generated credential in Chief's embedded browser. Chief captures it inside the trusted host and stores it in the prepared Executor connection without returning the value.",
        requestBody: body("GeneratedCredentialCaptureInput"),
        responses: { "200": { description: "Credential stored" } },
      },
    },
    "/local-tools/integrations/provider/open": {
      post: {
        operationId: "integration.openProviderPage",
        summary: "Open an integration provider page with automatic resume",
        description:
          "Opens a page belonging to the active integration. If provider authentication is required, Chief resumes this same setup agent automatically when the human reaches the requested page.",
        requestBody: body("ProviderPageInput"),
        responses: {
          "200": { description: "Provider page ready or sign-in required" },
        },
      },
    },
  };
}

export const integrationSetupOpenApiSchemas = {
  GeneratedCredentialCaptureInput: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId", "attemptId"],
    properties: {
      sessionId: { type: "string", maxLength: 160 },
      attemptId: { type: "string", maxLength: 160 },
    },
  },
  ProviderPageInput: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId", "attemptId", "url"],
    properties: {
      sessionId: { type: "string", maxLength: 160 },
      attemptId: { type: "string", maxLength: 160 },
      url: {
        type: "string",
        format: "uri",
        maxLength: 2000,
        description:
          "Exact HTTPS page on the active integration provider to reach after sign-in",
      },
    },
  },
} as const;

export interface IntegrationSetupLocalToolContext {
  openIntegrationHandoff?: (
    sessionId: string,
    attemptId: string,
    url: string,
  ) => Promise<void>;
  captureGeneratedCredential?: (
    sessionId: string,
    attemptId: string,
  ) => Promise<unknown>;
  openProviderPage?: (
    sessionId: string,
    attemptId: string,
    url: string,
  ) => Promise<unknown>;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
  max: number,
) {
  const raw = body[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${key} is required.`);
  }
  return raw.trim().slice(0, max);
}

export async function handleIntegrationSetupLocalTool(
  path: string,
  body: Record<string, unknown>,
  context: IntegrationSetupLocalToolContext,
): Promise<{ handled: boolean; value?: unknown }> {
  if (path === "/local-tools/integrations/handoff/open") {
    if (!context.openIntegrationHandoff) {
      throw new Error("Integration setup is unavailable.");
    }
    await context.openIntegrationHandoff(
      requiredString(body, "sessionId", 160),
      requiredString(body, "attemptId", 160),
      requiredString(body, "url", 2000),
    );
    return { handled: true, value: { opened: true } };
  }
  if (path === "/local-tools/integrations/credential/capture") {
    if (!context.captureGeneratedCredential) {
      throw new Error("Secure generated-credential capture is unavailable.");
    }
    return {
      handled: true,
      value: await context.captureGeneratedCredential(
        requiredString(body, "sessionId", 160),
        requiredString(body, "attemptId", 160),
      ),
    };
  }
  if (path === "/local-tools/integrations/provider/open") {
    if (!context.openProviderPage) {
      throw new Error("Provider browser authentication is unavailable.");
    }
    return {
      handled: true,
      value: await context.openProviderPage(
        requiredString(body, "sessionId", 160),
        requiredString(body, "attemptId", 160),
        requiredString(body, "url", 2000),
      ),
    };
  }
  return { handled: false };
}

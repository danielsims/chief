import type {
  BrowserAutomationCommand,
  BrowserAutomationResult,
} from "./types.js";

type RequestBody = ReturnType<(schema: string) => object>;

export function browserOpenApiPaths(body: (schema: string) => RequestBody) {
  return {
    "/local-tools/browser/open": {
      post: {
        operationId: "browser.open",
        summary: "Open or navigate Chief's embedded browser",
        description:
          "Shows an HTTP or HTTPS page beside the owning Chief conversation. Use the semantic browser tools to inspect and interact with it.",
        requestBody: body("BrowserOpenInput"),
        responses: { "200": { description: "Browser navigation sent" } },
      },
    },
    "/local-tools/browser/snapshot": {
      post: {
        operationId: "browser.snapshot",
        summary: "Inspect Chief's visible embedded browser page",
        description:
          "Returns the current URL, title, readable text, and visible semantic controls. Re-inspect after navigation or a material page change.",
        requestBody: body("BrowserConversationInput"),
        responses: { "200": { description: "Semantic page snapshot" } },
      },
    },
    "/local-tools/browser/click": {
      post: {
        operationId: "browser.click",
        summary: "Click an agent-browser ref or visible control",
        description:
          "Clicks the first matching current agent-browser snapshot ref or semantic label and returns the refreshed page snapshot. Prefer the exact @ref from the latest snapshot, including for radio-style option cards.",
        requestBody: body("BrowserLabelsInput"),
        responses: { "200": { description: "Click result" } },
      },
    },
    "/local-tools/browser/fill": {
      post: {
        operationId: "browser.fill",
        summary: "Fill a visible browser field by label",
        description:
          "Fills a non-secret visible field in Chief's embedded browser. Never request or fill passwords, passkeys, MFA codes, or account credentials; the user handles authentication directly.",
        requestBody: body("BrowserFillInput"),
        responses: { "200": { description: "Fill result" } },
      },
    },
    "/local-tools/browser/select": {
      post: {
        operationId: "browser.select",
        summary: "Choose an option in a visible browser select field",
        description:
          "Selects one or more values from a native select control using a current agent-browser ref or semantic label. Prefer this over keyboard navigation for select fields.",
        requestBody: body("BrowserSelectInput"),
        responses: { "200": { description: "Selection result" } },
      },
    },
    "/local-tools/browser/press": {
      post: {
        operationId: "browser.press",
        summary: "Press a key in the visible browser",
        description:
          "Presses a key such as Enter or Escape in the shared agent-browser session. Do not traverse controls with repeated Tab or arrow presses when the current snapshot exposes a clickable @ref.",
        requestBody: body("BrowserPressInput"),
        responses: { "200": { description: "Key press result" } },
      },
    },
  };
}

const labels = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  items: { type: "string", maxLength: 160 },
} as const;

export const browserOpenApiSchemas = {
  BrowserOpenInput: {
    type: "object",
    additionalProperties: false,
    required: ["conversationId", "url"],
    properties: {
      conversationId: {
        type: "string",
        maxLength: 160,
        description: "Exact owning Chief conversation ID from runtime context",
      },
      url: { type: "string", format: "uri", maxLength: 2_000 },
    },
  },
  BrowserConversationInput: {
    type: "object",
    additionalProperties: false,
    required: ["conversationId"],
    properties: { conversationId: { type: "string", maxLength: 160 } },
  },
  BrowserLabelsInput: {
    type: "object",
    additionalProperties: false,
    required: ["conversationId"],
    properties: {
      conversationId: { type: "string", maxLength: 160 },
      ref: {
        type: "string",
        maxLength: 32,
        description: "Exact ref from the latest browser snapshot",
      },
      labels,
    },
  },
  BrowserFillInput: {
    type: "object",
    additionalProperties: false,
    required: ["conversationId", "labels", "value"],
    properties: {
      conversationId: { type: "string", maxLength: 160 },
      labels,
      value: { type: "string", maxLength: 2_000 },
    },
  },
  BrowserSelectInput: {
    type: "object",
    additionalProperties: false,
    required: ["conversationId", "labels", "values"],
    properties: {
      conversationId: { type: "string", maxLength: 160 },
      labels,
      values: labels,
    },
  },
  BrowserPressInput: {
    type: "object",
    additionalProperties: false,
    required: ["conversationId", "key"],
    properties: {
      conversationId: { type: "string", maxLength: 160 },
      key: { type: "string", minLength: 1, maxLength: 80 },
    },
  },
} as const;

export interface BrowserLocalToolContext {
  openBrowser?: (conversationId: string, url: string) => void | Promise<void>;
  browserCommand?: (
    conversationId: string,
    command: BrowserAutomationCommand,
  ) => Promise<BrowserAutomationResult>;
}

function requiredString(body: Record<string, unknown>, key: string) {
  const raw = body[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${key} is required.`);
  }
  return raw.trim();
}

function stringList(body: Record<string, unknown>, key: string) {
  const raw = Array.isArray(body[key]) ? body[key] : [];
  const values = raw.slice(0, 8).map((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${key}[${index}] is required.`);
    }
    return value.trim().slice(0, 160);
  });
  if (values.length === 0) throw new Error(`${key} are required.`);
  return values;
}

export async function handleBrowserLocalTool(
  path: string,
  body: Record<string, unknown>,
  context: BrowserLocalToolContext,
): Promise<{ handled: boolean; value?: unknown }> {
  if (!path.startsWith("/local-tools/browser/")) return { handled: false };
  const conversationId = requiredString(body, "conversationId").slice(0, 160);
  if (path === "/local-tools/browser/open") {
    if (!context.openBrowser)
      throw new Error("The embedded browser is unavailable.");
    const rawUrl = requiredString(body, "url").slice(0, 2_000);
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("url must be a valid HTTP or HTTPS URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("url must use HTTP or HTTPS.");
    }
    await context.openBrowser(conversationId, url.toString());
    return { handled: true, value: { opened: true, url: url.toString() } };
  }
  if (!context.browserCommand) {
    throw new Error("The embedded browser is unavailable.");
  }
  if (path === "/local-tools/browser/snapshot") {
    return {
      handled: true,
      value: await context.browserCommand(conversationId, { type: "snapshot" }),
    };
  }
  if (path === "/local-tools/browser/press") {
    return {
      handled: true,
      value: await context.browserCommand(conversationId, {
        type: "press",
        key: requiredString(body, "key").slice(0, 80),
      }),
    };
  }
  const commandLabels = [
    ...(typeof body.ref === "string" && body.ref.trim()
      ? [body.ref.trim().replace(/^@?/, "@")]
      : []),
    ...(Array.isArray(body.labels) && body.labels.length > 0
      ? stringList(body, "labels")
      : []),
  ];
  if (commandLabels.length === 0) {
    throw new Error("ref or labels are required.");
  }
  let command: BrowserAutomationCommand | undefined;
  if (path === "/local-tools/browser/click") {
    command = { type: "click", labels: commandLabels };
  } else if (path === "/local-tools/browser/fill") {
    command = {
      type: "fill",
      labels: commandLabels,
      value: requiredString(body, "value").slice(0, 2_000),
    };
  } else if (path === "/local-tools/browser/select") {
    command = {
      type: "select",
      labels: commandLabels,
      values: stringList(body, "values"),
    };
  }
  if (!command) return { handled: false };
  return {
    handled: true,
    value: await context.browserCommand(conversationId, command),
  };
}

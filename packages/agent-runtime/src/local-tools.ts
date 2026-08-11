/* eslint-disable max-lines */

import { createHash, randomUUID } from "node:crypto";

import { channelOpenApiPaths, channelOpenApiSchemas } from "@chief/channel-api";

import type { BrowserLocalToolContext } from "./browser-local-tools.js";
import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { IntegrationSetupLocalToolContext } from "./integration-setup-local-tools.js";
import type { SessionManager } from "./manager.js";
import type { ScheduledWorkRunner } from "./scheduled-work-local-tools.js";
import type {
  AnalyticsDataset,
  CampaignRecord,
  ContentDraftRecord,
  InputRequest,
  ProspectRecord,
  RecurringWorkRecord,
  TrendRecord,
  WorkspaceFileRecord,
} from "./types.js";
import {
  browserOpenApiPaths,
  browserOpenApiSchemas,
  handleBrowserLocalTool,
} from "./browser-local-tools.js";
import { handleChannelLocalTool } from "./channel-local-tools.js";
import { assertSafeInputRequest } from "./input-values.js";
import {
  handleIntegrationSetupLocalTool,
  integrationSetupOpenApiPaths,
  integrationSetupOpenApiSchemas,
} from "./integration-setup-local-tools.js";
import { nextRunAt, validateCron } from "./recurring-work.js";
import { handleScheduledWorkLocalTool } from "./scheduled-work-local-tools.js";
import { runSpecialistDelegation } from "./specialist-delegation.js";
import {
  readWorkspaceBrandProfile,
  readWorkspaceContext,
  writeWorkspaceBrandProfile,
} from "./workspace-context.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function value(input: unknown, name: string, maximum: number, required = true) {
  if (typeof input !== "string" || !input.trim()) {
    if (required) throw new Error(`${name} is required.`);
    return undefined;
  }
  return input.trim().slice(0, maximum);
}

function requiredValue(input: unknown, name: string, maximum: number) {
  const result = value(input, name, maximum);
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function actionInputRequest(
  input: unknown,
  id: string,
  title: string,
  reason: string,
): InputRequest | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("request must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.slice(0, 8).map((step, index) => {
        if (!step || typeof step !== "object" || Array.isArray(step)) {
          throw new Error(`request.steps[${index}] must be an object.`);
        }
        const item = step as Record<string, unknown>;
        const text = requiredValue(
          item.text,
          `request.steps[${index}].text`,
          500,
        );
        const url = value(
          item.url,
          `request.steps[${index}].url`,
          1_000,
          false,
        );
        if (url && !/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) {
          throw new Error(
            "Action step URLs must use HTTP, HTTPS, or an absolute Chief app path.",
          );
        }
        return { text, ...(url ? { url } : {}) };
      })
    : undefined;
  const questions = Array.isArray(raw.questions)
    ? raw.questions.slice(0, 6).map((question, index) => {
        if (
          !question ||
          typeof question !== "object" ||
          Array.isArray(question)
        ) {
          throw new Error(`request.questions[${index}] must be an object.`);
        }
        const item = question as Record<string, unknown>;
        const options = Array.isArray(item.options)
          ? item.options.slice(0, 8).map((option, optionIndex) => {
              if (
                !option ||
                typeof option !== "object" ||
                Array.isArray(option)
              ) {
                throw new Error(
                  `request.questions[${index}].options[${optionIndex}] must be an object.`,
                );
              }
              const value = option as Record<string, unknown>;
              return {
                label: requiredValue(
                  value.label,
                  `request.questions[${index}].options[${optionIndex}].label`,
                  120,
                ),
                description: value.description
                  ? requiredValue(
                      value.description,
                      `request.questions[${index}].options[${optionIndex}].description`,
                      300,
                    )
                  : undefined,
              };
            })
          : [];
        return {
          question: requiredValue(
            item.question,
            `request.questions[${index}].question`,
            500,
          ),
          header: value(
            item.header,
            `request.questions[${index}].header`,
            80,
            false,
          ),
          multiSelect: item.multiSelect === true,
          options,
        };
      })
    : undefined;
  const fields = Array.isArray(raw.fields)
    ? raw.fields.slice(0, 8).map((field, index) => {
        if (!field || typeof field !== "object" || Array.isArray(field)) {
          throw new Error(`request.fields[${index}] must be an object.`);
        }
        const item = field as Record<string, unknown>;
        const save = item.save;
        if (!save || typeof save !== "object" || Array.isArray(save)) {
          throw new Error(`request.fields[${index}].save must be an object.`);
        }
        const destination = save as Record<string, unknown>;
        const envKey = value(
          destination.envKey,
          `request.fields[${index}].save.envKey`,
          120,
          false,
        );
        const file = value(
          destination.file,
          `request.fields[${index}].save.file`,
          240,
          false,
        );
        if (Boolean(envKey) === Boolean(file)) {
          throw new Error(
            `request.fields[${index}] must have exactly one vault destination.`,
          );
        }
        if (envKey && !/^[A-Z][A-Z0-9_]{1,119}$/.test(envKey)) {
          throw new Error(`${envKey} is not a valid environment key.`);
        }
        let fieldDestination: { envKey: string } | { file: string };
        if (envKey) {
          fieldDestination = { envKey };
        } else if (file) {
          fieldDestination = { file };
        } else {
          throw new Error(
            `request.fields[${index}] must have a vault destination.`,
          );
        }
        return {
          key: requiredValue(item.key, `request.fields[${index}].key`, 80),
          label: requiredValue(
            item.label,
            `request.fields[${index}].label`,
            160,
          ),
          type: choice(
            item.type,
            `request.fields[${index}].type`,
            ["text", "secret", "multiline"] as const,
            "text",
          ),
          save: fieldDestination,
        };
      })
    : [];
  if ((questions?.length ?? 0) === 0 && fields.length === 0) {
    throw new Error("An action request needs at least one question or field.");
  }
  if (new Set(fields.map((field) => field.key)).size !== fields.length) {
    throw new Error("Action request field keys must be unique.");
  }
  const request: InputRequest = {
    id,
    title,
    reason,
    steps,
    questions,
    fields,
  };
  assertSafeInputRequest(request);
  return request;
}

function choice<T extends string>(
  input: unknown,
  name: string,
  options: readonly T[],
  fallback: T,
) {
  if (input === undefined) return fallback;
  if (typeof input === "string" && options.includes(input as T)) {
    return input as T;
  }
  throw new Error(`${name} must be one of: ${options.join(", ")}.`);
}

function time(input: unknown, fallback = Date.now()) {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function amount(input: unknown, name: string) {
  if (input === undefined || input === null || input === "") return undefined;
  const parsed = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function fileSlug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "draft"
  );
}

function stringList(input: unknown, name: string, maximum = 30) {
  if (!Array.isArray(input)) throw new Error(`${name} must be a list.`);
  return input.slice(0, maximum).map((item) => requiredValue(item, name, 300));
}

function toolAddressList(input: unknown) {
  const addresses = stringList(input, "proposedToolPatterns");
  if (addresses.some((address) => !/^tools\.[A-Za-z0-9_.-]+$/.test(address))) {
    throw new Error(
      "proposedToolPatterns must contain exact Executor tool addresses.",
    );
  }
  return [...new Set(addresses)];
}

function analyticsSeries(input: unknown): AnalyticsDataset["series"] {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new Error("series must be a list.");
  return input.slice(0, 12).map((item, seriesIndex) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`series[${seriesIndex}] must be an object.`);
    }
    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.points) || record.points.length > 5_000) {
      throw new Error(`series[${seriesIndex}].points must be a bounded list.`);
    }
    return {
      id: requiredValue(record.id, `series[${seriesIndex}].id`, 120),
      label: requiredValue(record.label, `series[${seriesIndex}].label`, 200),
      metric: requiredValue(
        record.metric,
        `series[${seriesIndex}].metric`,
        120,
      ),
      points: record.points.map((point, pointIndex) => {
        if (!point || typeof point !== "object" || Array.isArray(point)) {
          throw new Error(
            `series[${seriesIndex}].points[${pointIndex}] must be an object.`,
          );
        }
        const value = point as Record<string, unknown>;
        if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
          throw new Error(
            `series[${seriesIndex}].points[${pointIndex}].value must be a number.`,
          );
        }
        return {
          x: requiredValue(
            value.x,
            `series[${seriesIndex}].points[${pointIndex}].x`,
            200,
          ),
          value: value.value,
        };
      }),
    };
  });
}

function analyticsDatasetInput(
  input: Record<string, unknown>,
): Omit<AnalyticsDataset, "capturedAt"> {
  if (JSON.stringify(input).length > 1_500_000) {
    throw new Error("Analytics dataset is too large.");
  }
  const provider = requiredValue(input.provider, "provider", 160);
  const sourceId = requiredValue(input.sourceId, "sourceId", 240);
  const key = requiredValue(input.key, "key", 120);
  const title = requiredValue(input.title, "title", 200);
  const series = analyticsSeries(input.series);
  if (
    !Array.isArray(input.metrics) ||
    input.metrics.length < 1 ||
    input.metrics.length > 40 ||
    !Array.isArray(input.dimensions) ||
    input.dimensions.length > 20 ||
    !Array.isArray(input.periods) ||
    input.periods.length > 24 ||
    (input.rows !== undefined &&
      (!Array.isArray(input.rows) || input.rows.length > 1_000)) ||
    (input.series !== undefined &&
      (!Array.isArray(input.series) || input.series.length > 12)) ||
    (input.charts !== undefined &&
      (!Array.isArray(input.charts) || input.charts.length > 8))
  ) {
    throw new Error("A valid bounded analytics dataset is required.");
  }
  return {
    ...(input as unknown as Omit<AnalyticsDataset, "capturedAt">),
    provider,
    sourceId,
    key,
    title,
    ...(series ? { series } : {}),
  };
}

export function localToolsOpenApi(origin: string) {
  const saveResponse = {
    "200": {
      description: "Saved workspace record",
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true },
        },
      },
    },
  };
  const body = (schema: string) => ({
    required: true,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schema}` },
      },
    },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "Chief Local Workspace Tools",
      version: "1.0.0",
      description:
        "Private, runtime-local workspace records for proactive marketing agents.",
    },
    servers: [{ url: origin }],
    security: [{ localWorkspaceCapability: [] }],
    paths: {
      "/local-tools/prospects": {
        get: {
          operationId: "prospects.list",
          summary: "List saved prospects",
          responses: { "200": { description: "Workspace prospects" } },
        },
        post: {
          operationId: "prospects.save",
          summary: "Save or update a prospect",
          requestBody: body("ProspectInput"),
          responses: saveResponse,
        },
      },
      ...channelOpenApiPaths(body),
      "/local-tools/trends": {
        get: {
          operationId: "trends.list",
          summary: "List saved trends",
          responses: { "200": { description: "Workspace trends" } },
        },
        post: {
          operationId: "trends.save",
          summary: "Save or update a trend",
          requestBody: body("TrendInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/analytics/datasets": {
        get: {
          operationId: "analytics.listDatasets",
          summary: "Read locally saved analytics datasets",
          responses: { "200": { description: "Workspace analytics datasets" } },
        },
        post: {
          operationId: "analytics.saveDataset",
          summary: "Save a provider-neutral analytics dataset on this Mac",
          description:
            "Atomically saves a reusable report projection. Use key overview and the connected account or property id as sourceId.",
          requestBody: body("AnalyticsDatasetInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/content": {
        get: {
          operationId: "content.list",
          summary: "List drafts and scheduled content",
          responses: { "200": { description: "Workspace content" } },
        },
        post: {
          operationId: "content.save",
          summary: "Create or update a content draft or scheduled post",
          description:
            "Saves the complete platform-ready body and creates a linked editable workspace document. Idea labels, outlines, and summaries are not finished drafts.",
          requestBody: body("ContentInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/files": {
        get: {
          operationId: "files.list",
          summary: "List editable workspace files",
          description:
            "Returns file ids, workspace-relative paths, types and current revision ids without loading every file body.",
          responses: { "200": { description: "Workspace files" } },
        },
      },
      "/local-tools/files/read": {
        post: {
          operationId: "files.read",
          summary: "Read an editable workspace file",
          requestBody: body("FileReadInput"),
          responses: { "200": { description: "File and current content" } },
        },
      },
      "/local-tools/files/write": {
        post: {
          operationId: "files.write",
          summary: "Create or revise a rich workspace document",
          description:
            "Saves an editable, versioned workspace document. Compose a useful visual hierarchy with concise sections, tables or checklists where suitable, and inline Markdown images using direct HTTPS URLs or absolute local image paths. Do not save a raw transcript, generic report dump, or headings-only outline. Pass expectedVersionId when revising so a user's newer edits are never overwritten.",
          requestBody: body("FileWriteInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/campaigns": {
        get: {
          operationId: "campaigns.list",
          summary: "List saved paid campaigns",
          responses: { "200": { description: "Workspace campaigns" } },
        },
        post: {
          operationId: "campaigns.save",
          summary: "Create or update a paid campaign plan",
          requestBody: body("CampaignInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/action": {
        post: {
          operationId: "action.raise",
          summary: "Create an action that genuinely requires the user",
          description:
            "Use sparingly: only for items the user must personally decide or act on. Include a structured request when Chief can collect the answer or credentials directly. Recording an action never completes the current task; continue every independent part.",
          requestBody: body("ActionInput"),
          responses: saveResponse,
        },
      },
      ...browserOpenApiPaths(body),
      "/local-tools/brand-profile": {
        post: {
          operationId: "brandProfile.save",
          summary: "Save the workspace brand profile",
          description:
            "Stores a researched or user-supplied brand profile so every agent receives it in future sessions and scheduled work.",
          requestBody: body("BrandProfileInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/specialists/delegate": {
        post: {
          operationId: "specialists.delegate",
          summary: "Delegate bounded work to a private specialist",
          description:
            "Creates or reuses an inspectable private child session. Returns its result when already available, otherwise returns working promptly while the specialist continues in the background. A working response is not a timeout and must not be retried immediately.",
          requestBody: body("SpecialistDelegationInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/setup/list": {
        post: {
          operationId: "setup.list",
          summary: "List integration setup tasks",
          description:
            "Lists the integrations Chief can set up for this workspace (for example Google Analytics, GitHub, Vercel). Call this first to see what setup work is possible before starting one.",
          requestBody: body("SetupListInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/setup/start": {
        post: {
          operationId: "setup.start",
          summary: "Start an integration setup task",
          description:
            "Starts an agent-driven integration setup in this conversation. Supply a domain from setup.list (for example analytics.googleapis.com). Chief prepares the integration, activates the setup run, and returns the exact step-by-step instructions for completing it. Use this instead of asking the user to open a Settings page or click Connect.",
          requestBody: body("SetupStartInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/integrations/google-analytics/authorize": {
        post: {
          operationId: "googleAnalytics.authorize",
          summary: "Start Google Analytics authorization",
          description:
            "Starts the preconfigured read-only Google OAuth connection and returns the browser URL. Use only in a user-started integration setup run.",
          requestBody: body("IntegrationSetupSessionInput"),
          responses: { "200": { description: "Authorization URL and state" } },
        },
      },
      "/local-tools/integrations/google-oauth/provision-client": {
        post: {
          operationId: "googleOAuth.provisionClient",
          summary: "Begin user-owned Google OAuth client setup",
          description:
            "Opens Google's account chooser and arranges for this same agent to resume after the user authenticates. After resumption, use Chief's ordinary browser tools to complete Google Cloud setup.",
          requestBody: body("IntegrationSetupSessionInput"),
          responses: {
            "200": {
              description: "Configured, or one precise user action required",
            },
          },
        },
      },
      "/local-tools/integrations/google-oauth/capture-client": {
        post: {
          operationId: "googleOAuth.captureClient",
          summary: "Securely capture and store a Google OAuth client",
          description:
            "Call from Google's client-created dialog or the matching client edit page. Chief captures, validates, routes, and stores the client without returning its ID or secret.",
          requestBody: body("IntegrationSetupSessionInput"),
          responses: { "200": { description: "OAuth client stored" } },
        },
      },
      "/local-tools/integrations/google-analytics/complete": {
        post: {
          operationId: "googleAnalytics.complete",
          summary: "Complete and verify Google Analytics authorization",
          description:
            "Waits for browser consent when state is supplied, discovers accessible properties, runs a live report, and saves a single-property connection. If several properties exist it returns choices without guessing.",
          requestBody: body("GoogleAnalyticsCompleteInput"),
          responses: {
            "200": { description: "Verified connection or property choices" },
          },
        },
      },
      "/local-tools/integrations/google-analytics/select": {
        post: {
          operationId: "googleAnalytics.select",
          summary: "Select and verify a Google Analytics property",
          requestBody: body("GoogleAnalyticsSelectInput"),
          responses: {
            "200": { description: "Verified Google Analytics property" },
          },
        },
      },
      ...integrationSetupOpenApiPaths(body),
      "/local-tools/recurring-work": {
        get: {
          operationId: "recurringWork.list",
          summary: "List recurring agent work and approval state",
          responses: { "200": { description: "Workspace recurring work" } },
        },
        post: {
          operationId: "recurringWork.propose",
          summary: "Create recurring agent work under workspace policy",
          description:
            "Creates a reviewable draft by default. Immediate activation is accepted only when onboarding granted automatic scheduling authority.",
          requestBody: body("RecurringWorkInput"),
          responses: saveResponse,
        },
      },
    },
    components: {
      securitySchemes: {
        localWorkspaceCapability: { type: "http", scheme: "bearer" },
      },
      schemas: {
        ...browserOpenApiSchemas,
        ActionInput: {
          type: "object",
          additionalProperties: false,
          required: ["title", "reason"],
          properties: {
            agentId: { type: "string", maxLength: 120 },
            sourceId: {
              type: "string",
              maxLength: 160,
              description:
                "Exact current Chief session ID from the runtime context",
            },
            dedupeKey: {
              type: "string",
              maxLength: 120,
              description:
                "Stable semantic key reused for equivalent actions from the same source session",
            },
            title: { type: "string", maxLength: 200 },
            reason: {
              type: "string",
              minLength: 20,
              maxLength: 1000,
              description:
                "Why this needs the user personally: the decision to make or action to take, stated concretely.",
            },
            request: {
              type: "object",
              description:
                "A beginner-safe form rendered in Chief's action UI. Give exact numbered steps in click order, link every web or Chief destination, request only values needed at this stage, and never ask for an account/property id before a connected API can list named choices.",
              additionalProperties: false,
              properties: {
                steps: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["text"],
                    properties: {
                      text: {
                        type: "string",
                        maxLength: 500,
                        description:
                          "One beginner-safe instruction naming the exact page, control, value, and expected result. Do not use vague directions such as open settings or connect the source.",
                      },
                      url: {
                        type: "string",
                        maxLength: 1000,
                        description:
                          "Direct HTTPS destination or absolute Chief route such as /settings/integrations. Include this whenever the step tells the user to open or click somewhere.",
                      },
                    },
                  },
                },
                questions: {
                  type: "array",
                  maxItems: 6,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["question"],
                    properties: {
                      header: { type: "string", maxLength: 80 },
                      question: { type: "string", maxLength: 500 },
                      multiSelect: { type: "boolean" },
                      options: {
                        type: "array",
                        maxItems: 8,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["label"],
                          properties: {
                            label: { type: "string", maxLength: 120 },
                            description: { type: "string", maxLength: 300 },
                          },
                        },
                      },
                    },
                  },
                },
                fields: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["key", "label", "save"],
                    properties: {
                      key: { type: "string", maxLength: 80 },
                      label: { type: "string", maxLength: 160 },
                      type: {
                        type: "string",
                        enum: ["text", "secret", "multiline"],
                      },
                      save: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          envKey: { type: "string", maxLength: 120 },
                          file: { type: "string", maxLength: 240 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        BrandProfileInput: {
          type: "object",
          additionalProperties: false,
          required: ["markdown"],
          properties: {
            markdown: {
              type: "string",
              minLength: 100,
              maxLength: 20000,
            },
          },
        },
        SpecialistDelegationInput: {
          type: "object",
          additionalProperties: false,
          required: [
            "conversationId",
            "delegationId",
            "agentId",
            "title",
            "task",
          ],
          properties: {
            conversationId: { type: "string", maxLength: 160 },
            delegationId: {
              type: "string",
              pattern: "^[a-z0-9][a-z0-9-]{5,63}$",
              description:
                "A stable caller correlation id. Reuse it for retries; equivalent tasks are deduplicated server-side.",
            },
            agentId: {
              type: "string",
              enum: [
                "brand",
                "content",
                "analyst",
                "prospector",
                "ads",
                "setup",
              ],
            },
            title: { type: "string", maxLength: 160 },
            task: { type: "string", maxLength: 8000 },
            channelId: {
              type: "string",
              maxLength: 160,
              description:
                "Owning shared channel when this specialist has a visible work thread.",
            },
            threadRootId: {
              type: "string",
              maxLength: 160,
              description:
                "Durable channel message ID that owns this specialist's visible work. Use the event ID returned by channels.messages.post after @mentioning the specialist.",
            },
            setupDomain: {
              type: "string",
              description:
                "Optional for Setup. Supply together with setupAttemptId only for an active integration setup attempt; omit both for bounded technical growth work.",
            },
            setupAttemptId: {
              type: "string",
              description:
                "Optional for Setup. Supply together with setupDomain only for an active integration setup attempt; omit both for bounded technical growth work.",
            },
            waitSeconds: {
              type: "number",
              minimum: 1,
              maximum: 90,
              description:
                "How long to wait for a completed result before returning working. Use 90 for a user-requested Analyst query; omit for background research.",
            },
          },
        },
        GoogleAnalyticsCompleteInput: {
          type: "object",
          additionalProperties: false,
          required: ["sessionId", "attemptId"],
          properties: {
            sessionId: { type: "string" },
            attemptId: { type: "string" },
            state: {
              type: "string",
              description:
                "OAuth state returned by googleAnalytics.authorize. Omit when a connection already exists.",
            },
          },
        },
        GoogleAnalyticsSelectInput: {
          type: "object",
          additionalProperties: false,
          required: ["sessionId", "attemptId", "propertyId"],
          properties: {
            sessionId: { type: "string" },
            attemptId: { type: "string" },
            propertyId: { type: "string" },
          },
        },
        IntegrationSetupSessionInput: {
          type: "object",
          additionalProperties: false,
          required: ["sessionId", "attemptId"],
          properties: {
            sessionId: { type: "string" },
            attemptId: { type: "string" },
          },
        },
        SetupListInput: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        SetupStartInput: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId", "domain"],
          properties: {
            conversationId: {
              type: "string",
              maxLength: 160,
              description: "Owning Chief conversation ID from Runtime context",
            },
            domain: {
              type: "string",
              maxLength: 255,
              description:
                "Integration domain from setup.list, for example analytics.googleapis.com",
            },
          },
        },
        IntegrationHandoffInput: {
          type: "object",
          additionalProperties: false,
          required: ["sessionId", "attemptId", "url"],
          properties: {
            sessionId: { type: "string" },
            attemptId: { type: "string" },
            url: { type: "string" },
          },
        },
        ...integrationSetupOpenApiSchemas,
        ...channelOpenApiSchemas,
        ProspectInput: {
          type: "object",
          additionalProperties: false,
          required: ["name", "source", "sourceUrl", "summary"],
          properties: {
            id: { type: "string" },
            playbookId: {
              type: "string",
              description:
                "Playbook approved during onboarding; required for immediate activation",
            },
            name: { type: "string" },
            company: { type: "string" },
            source: { type: "string" },
            sourceUrl: {
              type: "string",
              description:
                "Direct HTTP or HTTPS URL to the exact public post, profile, company page, or conversation that supports this prospect.",
            },
            summary: { type: "string" },
            relevance: { type: "string", enum: ["high", "medium", "low"] },
            status: {
              type: "string",
              enum: ["new", "researching", "contacted", "dismissed"],
            },
            foundAt: { oneOf: [{ type: "number" }, { type: "string" }] },
          },
        },
        TrendInput: {
          type: "object",
          additionalProperties: false,
          required: ["title", "source", "summary"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            source: { type: "string" },
            sourceUrl: { type: "string" },
            summary: { type: "string" },
            signal: { type: "string", enum: ["high", "medium", "low"] },
            status: {
              type: "string",
              enum: ["new", "watching", "acted", "dismissed"],
            },
            foundAt: { oneOf: [{ type: "number" }, { type: "string" }] },
          },
        },
        AnalyticsDatasetInput: {
          type: "object",
          additionalProperties: false,
          required: [
            "provider",
            "sourceId",
            "key",
            "title",
            "metrics",
            "dimensions",
            "periods",
          ],
          properties: {
            provider: { type: "string", maxLength: 160 },
            sourceId: { type: "string", maxLength: 240 },
            key: { type: "string", maxLength: 120 },
            title: { type: "string", maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            metrics: {
              type: "array",
              minItems: 1,
              maxItems: 40,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "label", "format"],
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                  format: {
                    type: "string",
                    enum: ["number", "currency", "percent", "duration"],
                  },
                  unit: { type: "string" },
                  currency: { type: "string" },
                },
              },
            },
            dimensions: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                required: ["key", "label"],
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                },
              },
            },
            periods: {
              type: "array",
              maxItems: 24,
              items: {
                type: "object",
                required: ["key", "label", "startDate", "endDate", "values"],
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                  startDate: { type: "string" },
                  endDate: { type: "string" },
                  values: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["metric", "value"],
                      properties: {
                        metric: { type: "string" },
                        value: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
            rows: { type: "array", maxItems: 1000 },
            series: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "label", "metric", "points"],
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  metric: { type: "string" },
                  points: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["x", "value"],
                      properties: {
                        x: { type: "string" },
                        value: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
            charts: { type: "array", maxItems: 8 },
            provenance: { type: "object", additionalProperties: true },
          },
        },
        ContentInput: {
          type: "object",
          additionalProperties: false,
          required: ["title", "body", "platform"],
          properties: {
            id: { type: "string" },
            agentId: { type: "string" },
            title: { type: "string" },
            body: {
              type: "string",
              minLength: 100,
              maxLength: 20000,
              description:
                "The complete publish-ready post, thread, caption, or script for the named platform, not a synopsis.",
            },
            platform: { type: "string" },
            status: {
              type: "string",
              enum: ["draft", "approved", "scheduled", "published"],
            },
            scheduledFor: { oneOf: [{ type: "number" }, { type: "string" }] },
          },
        },
        FileReadInput: {
          type: "object",
          additionalProperties: false,
          required: ["fileId"],
          properties: { fileId: { type: "string" } },
        },
        FileWriteInput: {
          type: "object",
          additionalProperties: false,
          required: ["name", "content"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            path: {
              type: "string",
              description:
                "Optional workspace-relative .md or .txt path, for example emails/welcome.md",
            },
            content: { type: "string" },
            kind: { type: "string", enum: ["document", "email"] },
            expectedVersionId: { type: "string" },
            agentId: { type: "string" },
            sourceSessionId: { type: "string" },
          },
        },
        CampaignInput: {
          type: "object",
          additionalProperties: false,
          required: ["name", "provider"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            provider: { type: "string" },
            objective: { type: "string" },
            status: {
              type: "string",
              enum: ["draft", "in_review", "live", "paused", "completed"],
            },
            currency: { type: "string" },
            budget: { type: "number", minimum: 0 },
            spend: { type: "number", minimum: 0 },
            revenue: { type: "number", minimum: 0 },
          },
        },
        RecurringWorkInput: {
          type: "object",
          additionalProperties: false,
          required: [
            "conversationId",
            "agentId",
            "title",
            "instructions",
            "cron",
            "timezone",
            "approvalSummary",
            "proposedToolPatterns",
          ],
          properties: {
            id: { type: "string" },
            conversationId: {
              type: "string",
              description:
                "Exact owning Chief conversation ID from the runtime context",
            },
            playbookId: {
              type: "string",
              description:
                "Starter playbook approved during onboarding, required for automatic activation",
            },
            agentId: { type: "string" },
            title: { type: "string" },
            instructions: { type: "string" },
            cron: {
              type: "string",
              description: "Standard five-field cron expression",
            },
            timezone: { type: "string", description: "IANA timezone" },
            onceAt: {
              oneOf: [{ type: "number" }, { type: "string" }],
              description:
                "Exact timestamp for one-off work. Omit for recurring work.",
            },
            approvalSummary: {
              type: "string",
              description:
                "Plain-language description of what will happen without asking again",
            },
            proposedToolPatterns: {
              type: "array",
              items: { type: "string" },
              description:
                "Exact Executor tool addresses required by this work",
            },
            activate: {
              type: "boolean",
              default: false,
              description:
                "Activate immediately only when the workspace context explicitly grants automatic scheduling authority",
            },
          },
        },
      },
    },
  };
}

export type LocalToolContext = BrowserLocalToolContext &
  IntegrationSetupLocalToolContext & {
    channels?: ChannelLocalToolContext;
    scheduledWork?: ScheduledWorkRunner;
    conversationId?: string;
    onActivity?: () => void | Promise<void>;
    onFilesChanged?: () => void | Promise<void>;
    onFileWritten?: (file: WorkspaceFileRecord) => void | Promise<void>;
    activateIntegrationSetup?: (
      sessionId: string,
      attemptId: string,
      domain: string,
    ) => void | Promise<void>;
    startSetup?: (
      sessionId: string,
      domain: string,
    ) => Promise<{
      attemptId: string;
      domain: string;
      label: string;
      instructions: string;
      available: { id: string; domain: string; label: string }[];
    }>;
    listSetupTasks?: () => Promise<
      { id: string; domain: string; label: string }[]
    >;
    googleOAuth?: {
      provisionClient?: (
        sessionId: string,
        attemptId: string,
      ) => Promise<unknown>;
      captureClient?: (
        sessionId: string,
        attemptId: string,
      ) => Promise<unknown>;
    };
    googleAnalytics?: {
      startAuthorization: (
        sessionId: string,
        attemptId: string,
      ) => Promise<{
        authorizationUrl: string;
        state: string;
      }>;
      completeAuthorization: (
        sessionId: string,
        attemptId: string,
        state?: string,
      ) => Promise<unknown>;
      selectProperty: (
        sessionId: string,
        attemptId: string,
        propertyId: string,
      ) => Promise<unknown>;
    };
  };

export async function handleLocalTool(
  request: Request,
  workspaceId: string,
  manager: SessionManager,
  context: LocalToolContext = {},
) {
  const path = new URL(request.url).pathname;
  const data = await manager.workspaceData(workspaceId);
  const rawChannelBody: unknown =
    request.method === "GET"
      ? {}
      : await request
          .clone()
          .json()
          .catch(() => ({}));
  const channelBody =
    rawChannelBody &&
    typeof rawChannelBody === "object" &&
    !Array.isArray(rawChannelBody)
      ? (rawChannelBody as Record<string, unknown>)
      : {};
  const channelResult = await handleChannelLocalTool(
    request,
    workspaceId,
    channelBody,
    context.channels,
  );
  if (channelResult.handled) {
    return json(channelResult.value, channelResult.status);
  }
  const scheduledWorkResult = await handleScheduledWorkLocalTool({
    request,
    workspaceId,
    body: channelBody,
    manager,
    runner: context.scheduledWork,
    conversationId: context.conversationId,
    origin: new URL(request.url).origin,
  });
  if (scheduledWorkResult.handled) {
    return json(scheduledWorkResult.value, scheduledWorkResult.status);
  }
  if (request.method === "GET") {
    if (path === "/local-tools/prospects")
      return json({ prospects: data.prospects });
    if (path === "/local-tools/trends") return json({ trends: data.trends });
    if (path === "/local-tools/analytics/datasets") {
      const provider = new URL(request.url).searchParams.get("provider");
      return json({
        datasets: provider
          ? data.analyticsDatasets.filter(
              (dataset) => dataset.provider === provider,
            )
          : data.analyticsDatasets,
      });
    }
    if (path === "/local-tools/content") return json({ drafts: data.drafts });
    if (path === "/local-tools/files") {
      return json({ files: await manager.listWorkspaceFiles(workspaceId) });
    }
    if (path === "/local-tools/campaigns") {
      return json({ campaigns: data.campaigns });
    }
    if (path === "/local-tools/brand-profile") {
      return json({
        configured: Boolean(readWorkspaceBrandProfile(workspaceId)?.trim()),
      });
    }
    if (path === "/local-tools/recurring-work") {
      return json({ recurringWork: data.recurringWork });
    }
  }
  if (request.method !== "POST") return json({ error: "Not found" }, 404);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }
  try {
    const browser = await handleBrowserLocalTool(path, body, context);
    if (browser.handled) return json(browser.value);
    if (path === "/local-tools/integrations/google-oauth/provision-client") {
      if (!context.googleOAuth?.provisionClient) {
        throw new Error("Google OAuth client provisioning is unavailable.");
      }
      return json(
        await context.googleOAuth.provisionClient(
          requiredValue(body.sessionId, "sessionId", 160),
          requiredValue(body.attemptId, "attemptId", 160),
        ),
      );
    }
    if (path === "/local-tools/integrations/google-oauth/capture-client") {
      if (!context.googleOAuth?.captureClient) {
        throw new Error("Google OAuth credential capture is unavailable.");
      }
      return json(
        await context.googleOAuth.captureClient(
          requiredValue(body.sessionId, "sessionId", 160),
          requiredValue(body.attemptId, "attemptId", 160),
        ),
      );
    }
    if (path === "/local-tools/integrations/google-analytics/authorize") {
      if (!context.googleAnalytics) {
        throw new Error("Google Analytics setup is unavailable.");
      }
      return json(
        await context.googleAnalytics.startAuthorization(
          requiredValue(body.sessionId, "sessionId", 160),
          requiredValue(body.attemptId, "attemptId", 160),
        ),
      );
    }
    if (path === "/local-tools/integrations/google-analytics/complete") {
      if (!context.googleAnalytics) {
        throw new Error("Google Analytics setup is unavailable.");
      }
      return json(
        await context.googleAnalytics.completeAuthorization(
          requiredValue(body.sessionId, "sessionId", 160),
          requiredValue(body.attemptId, "attemptId", 160),
          value(body.state, "state", 240, false),
        ),
      );
    }
    if (path === "/local-tools/integrations/google-analytics/select") {
      if (!context.googleAnalytics) {
        throw new Error("Google Analytics setup is unavailable.");
      }
      return json(
        await context.googleAnalytics.selectProperty(
          requiredValue(body.sessionId, "sessionId", 160),
          requiredValue(body.attemptId, "attemptId", 160),
          requiredValue(body.propertyId, "propertyId", 240),
        ),
      );
    }
    const integrationSetup = await handleIntegrationSetupLocalTool(
      path,
      body,
      context,
    );
    if (integrationSetup.handled) return json(integrationSetup.value);
    if (path === "/local-tools/setup/list") {
      if (!context.listSetupTasks) {
        throw new Error("Setup task discovery is unavailable.");
      }
      return json({ available: await context.listSetupTasks() });
    }
    if (path === "/local-tools/setup/start") {
      if (!context.startSetup) {
        throw new Error("Agent-driven setup is unavailable.");
      }
      const conversationId = requiredValue(
        body.conversationId ?? context.conversationId,
        "conversationId",
        160,
      );
      return json(
        await context.startSetup(
          conversationId,
          requiredValue(body.domain, "domain", 255),
        ),
      );
    }
    if (path === "/local-tools/specialists/delegate") {
      const delegationId = requiredValue(body.delegationId, "delegationId", 64);
      if (!/^[a-z0-9][a-z0-9-]{5,63}$/.test(delegationId)) {
        throw new Error("delegationId must be a unique lowercase slug.");
      }
      const agentId = requiredValue(body.agentId, "agentId", 120);
      const setupDomain =
        agentId === "setup" && typeof body.setupDomain === "string"
          ? requiredValue(body.setupDomain, "setupDomain", 255)
          : undefined;
      const setupAttemptId =
        agentId === "setup" && typeof body.setupAttemptId === "string"
          ? requiredValue(body.setupAttemptId, "setupAttemptId", 160)
          : undefined;
      if (Boolean(setupDomain) !== Boolean(setupAttemptId)) {
        throw new Error(
          "setupDomain and setupAttemptId must be supplied together.",
        );
      }
      const delegation = runSpecialistDelegation({
        manager,
        workspaceId,
        conversationId: requiredValue(
          body.conversationId,
          "conversationId",
          160,
        ),
        delegationId,
        agentId,
        title: requiredValue(body.title, "title", 160),
        task: requiredValue(body.task, "task", 8_000),
        channelId:
          typeof body.channelId === "string"
            ? requiredValue(body.channelId, "channelId", 160)
            : undefined,
        threadRootId:
          typeof body.threadRootId === "string"
            ? requiredValue(body.threadRootId, "threadRootId", 160)
            : undefined,
        setupDomain,
        setupAttemptId,
        onStateChange: context.onActivity,
        onFilesChange: context.onFilesChanged,
        onSessionReady:
          setupDomain && setupAttemptId && context.activateIntegrationSetup
            ? (sessionId) =>
                context.activateIntegrationSetup?.(
                  sessionId,
                  setupAttemptId,
                  setupDomain,
                )
            : undefined,
      });
      const waitSeconds =
        typeof body.waitSeconds === "number" &&
        Number.isFinite(body.waitSeconds)
          ? Math.max(1, Math.min(90, body.waitSeconds))
          : 0;
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        delegation,
        new Promise<{ status: "working"; delegationId: string }>((resolve) => {
          timer = setTimeout(
            () => resolve({ status: "working", delegationId }),
            waitSeconds * 1_000,
          );
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      return json(result);
    }
    if (path === "/local-tools/prospects") {
      const sourceUrl = requiredValue(body.sourceUrl, "sourceUrl", 500);
      if (!/^https?:\/\//i.test(sourceUrl)) {
        throw new Error("sourceUrl must be a direct HTTP or HTTPS URL.");
      }
      const prospect: ProspectRecord = {
        id: value(body.id, "id", 120, false) ?? randomUUID(),
        name: requiredValue(body.name, "name", 160),
        company: value(body.company, "company", 160, false),
        source: requiredValue(body.source, "source", 120),
        sourceUrl,
        summary: requiredValue(body.summary, "summary", 2_000),
        relevance: choice(
          body.relevance,
          "relevance",
          ["high", "medium", "low"],
          "medium",
        ),
        status: choice(
          body.status,
          "status",
          ["new", "researching", "contacted", "dismissed"],
          "new",
        ),
        foundAt: time(body.foundAt),
      };
      await manager.saveProspect(workspaceId, prospect);
      return json({ prospect });
    }
    if (path === "/local-tools/trends") {
      const sourceUrl = value(body.sourceUrl, "sourceUrl", 500, false);
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
        throw new Error("sourceUrl must be a direct HTTP or HTTPS URL.");
      }
      const trend: TrendRecord = {
        id: value(body.id, "id", 120, false) ?? randomUUID(),
        title: requiredValue(body.title, "title", 200),
        source: requiredValue(body.source, "source", 120),
        sourceUrl,
        summary: requiredValue(body.summary, "summary", 2_000),
        signal: choice(
          body.signal,
          "signal",
          ["high", "medium", "low"],
          "medium",
        ),
        status: choice(
          body.status,
          "status",
          ["new", "watching", "acted", "dismissed"],
          "new",
        ),
        foundAt: time(body.foundAt),
      };
      await manager.saveTrend(workspaceId, trend);
      return json({ trend });
    }
    if (path === "/local-tools/analytics/datasets") {
      const dataset = await manager.saveAnalyticsDataset(
        workspaceId,
        analyticsDatasetInput(body),
      );
      return json({ dataset });
    }
    if (path === "/local-tools/content") {
      const now = Date.now();
      const scheduledFor =
        body.scheduledFor === undefined ? undefined : time(body.scheduledFor);
      const id = value(body.id, "id", 120, false) ?? randomUUID();
      const title = requiredValue(body.title, "title", 200);
      const content = requiredValue(body.body, "body", 20_000);
      if (content.length < 100) {
        throw new Error(
          "body must contain the complete platform-ready draft, not an idea or outline.",
        );
      }
      const existingDraft = data.drafts.find((item) => item.id === id);
      const existingFile = existingDraft?.fileId
        ? await manager.workspaceFile(workspaceId, existingDraft.fileId)
        : null;
      const file = await manager.saveWorkspaceFile(workspaceId, {
        id: existingFile?.id,
        name: title,
        path:
          existingFile?.path ??
          `content/${fileSlug(title)}-${id.slice(0, 8)}.md`,
        content,
        kind: "document",
        expectedVersionId: existingFile?.currentVersionId,
        createdBy: "agent",
        sourceAgentId:
          value(body.agentId, "agentId", 80, false) ??
          existingDraft?.agentId ??
          "chief",
      });
      const draft: ContentDraftRecord = {
        id,
        agentId:
          value(body.agentId, "agentId", 80, false) ??
          existingDraft?.agentId ??
          "chief",
        title,
        body: content,
        platform: requiredValue(body.platform, "platform", 80),
        fileId: file.id,
        status: choice(
          body.status,
          "status",
          ["draft", "approved", "scheduled", "published"],
          scheduledFor ? "scheduled" : "draft",
        ),
        scheduledFor: scheduledFor ?? existingDraft?.scheduledFor,
        createdAt: existingDraft?.createdAt ?? now,
        updatedAt: now,
      };
      await manager.saveDraft(workspaceId, draft);
      return json({ draft, file });
    }
    if (path === "/local-tools/files/read") {
      const fileId = requiredValue(body.fileId, "fileId", 120);
      const file = await manager.workspaceFile(workspaceId, fileId);
      if (!file) return json({ error: "File not found." }, 404);
      return json({ file });
    }
    if (path === "/local-tools/files/write") {
      const file = await manager.saveWorkspaceFile(workspaceId, {
        id: value(body.id, "id", 120, false),
        name: requiredValue(body.name, "name", 160),
        path: value(body.path, "path", 240, false),
        content: requiredValue(body.content, "content", 1_000_000),
        kind: choice<"document" | "email">(
          body.kind,
          "kind",
          ["document", "email"],
          "document",
        ),
        expectedVersionId: value(
          body.expectedVersionId,
          "expectedVersionId",
          120,
          false,
        ),
        createdBy: "agent",
        sourceAgentId: value(body.agentId, "agentId", 80, false),
        sourceSessionId: value(
          body.sourceSessionId,
          "sourceSessionId",
          120,
          false,
        ),
      });
      await context.onFileWritten?.(file);
      return json({ file });
    }
    if (path === "/local-tools/campaigns") {
      const now = Date.now();
      const campaign: CampaignRecord = {
        id: value(body.id, "id", 120, false) ?? randomUUID(),
        name: requiredValue(body.name, "name", 200),
        provider: requiredValue(body.provider, "provider", 120),
        objective: value(body.objective, "objective", 500, false),
        status: choice(
          body.status,
          "status",
          ["draft", "in_review", "live", "paused", "completed"],
          "draft",
        ),
        currency: value(body.currency, "currency", 8, false) ?? "USD",
        budget: amount(body.budget, "budget"),
        spend: amount(body.spend, "spend"),
        revenue: amount(body.revenue, "revenue"),
        createdAt: now,
        updatedAt: now,
      };
      await manager.saveCampaign(workspaceId, campaign);
      return json({ campaign });
    }
    if (path === "/local-tools/brand-profile") {
      const markdown = requiredValue(body.markdown, "markdown", 20_000);
      if (markdown.length < 100) {
        throw new Error("brand profile must contain at least 100 characters.");
      }
      writeWorkspaceBrandProfile(workspaceId, markdown);
      return json({ saved: true });
    }
    if (path === "/local-tools/recurring-work") {
      const now = Date.now();
      const id = value(body.id, "id", 120, false) ?? randomUUID();
      const existing = await manager.recurringWorkById(workspaceId, id);
      const cron = requiredValue(body.cron, "cron", 120);
      const timezone = requiredValue(body.timezone, "timezone", 120);
      const onceAt =
        body.onceAt === undefined
          ? existing?.onceAt
          : time(body.onceAt, Number.NaN);
      if (onceAt !== undefined && !Number.isFinite(onceAt)) {
        throw new Error("onceAt must be a valid timestamp.");
      }
      validateCron(cron, timezone);
      const activate = body.activate === true;
      const workspaceContext = readWorkspaceContext(workspaceId);
      const schedulingAuthority = workspaceContext?.match(
        /^Agent scheduling authority:\s*(automatic|review|manual)$/im,
      )?.[1];
      if (activate && schedulingAuthority !== "automatic") {
        throw new Error(
          "This workspace requires schedule review. Create a draft without activate.",
        );
      }
      const agentId = requiredValue(body.agentId, "agentId", 120);
      const playbookId = value(body.playbookId, "playbookId", 120, false);
      if (activate) {
        let scope: {
          playbookId?: string;
          agentId?: string;
          cron?: string;
          timezone?: string;
        }[] = [];
        try {
          const encoded = workspaceContext?.match(
            /^Automatic schedule scope:\s*(.+)$/im,
          )?.[1];
          const parsed: unknown = encoded ? JSON.parse(encoded) : [];
          scope = Array.isArray(parsed)
            ? (parsed as unknown[]).filter(
                (item): item is (typeof scope)[number] =>
                  Boolean(item) &&
                  typeof item === "object" &&
                  !Array.isArray(item) &&
                  ["playbookId", "agentId", "cron", "timezone"].every(
                    (key) =>
                      (item as Record<string, unknown>)[key] === undefined ||
                      typeof (item as Record<string, unknown>)[key] ===
                        "string",
                  ),
              )
            : [];
        } catch {
          scope = [];
        }
        const approved = scope.find(
          (item) =>
            item.playbookId === playbookId &&
            item.agentId === agentId &&
            item.cron === cron &&
            item.timezone === timezone,
        );
        if (!approved) {
          throw new Error(
            "This schedule is outside the starter plan approved during onboarding. Create a draft without activate.",
          );
        }
      }
      const proposedToolPatterns = toolAddressList(body.proposedToolPatterns);
      const conversationId =
        value(body.conversationId, "conversationId", 160, false) ??
        context.conversationId ??
        existing?.conversationId;
      if (!conversationId) {
        throw new Error(
          "conversationId from the current runtime context is required.",
        );
      }
      const work: RecurringWorkRecord = {
        id,
        conversationId,
        agentId,
        title: requiredValue(body.title, "title", 200),
        instructions: requiredValue(body.instructions, "instructions", 8_000),
        cron,
        timezone,
        onceAt,
        status: activate ? "active" : "draft",
        placement: "local",
        approvalSummary: requiredValue(
          body.approvalSummary,
          "approvalSummary",
          2_000,
        ),
        proposedToolPatterns,
        grant: activate
          ? { version: 1, approvedAt: now, toolPatterns: proposedToolPatterns }
          : undefined,
        nextAt: activate
          ? onceAt !== undefined && onceAt <= now
            ? now
            : (onceAt ?? nextRunAt(cron, timezone))
          : undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await manager.saveRecurringWork(workspaceId, work);
      if (!activate) {
        // The proposal itself is the action item; agents must not raise a second one.
        await manager.raiseActionItem(workspaceId, {
          id: `action-${work.id}-approval`,
          agentId: work.agentId,
          title: `Approve: ${work.title}`,
          reason: work.approvalSummary,
          sourceId: `automation-${work.id}`,
          status: "open",
          createdAt: Date.now(),
        });
      }
      return json({
        recurringWork: work,
        requiresUserApproval: !activate,
        activated: activate,
      });
    }
    if (path === "/local-tools/action") {
      const title = requiredValue(body.title, "title", 200);
      const reason = requiredValue(body.reason, "reason", 1_000);
      if (reason.trim().length < 20) {
        throw new Error(
          "A concrete reason is required: state the decision or action the user must take.",
        );
      }
      const sourceId = value(body.sourceId, "sourceId", 160, false);
      const dedupeKey =
        value(body.dedupeKey, "dedupeKey", 120, false) ??
        title.toLowerCase().replaceAll(/\s+/g, "-");
      const id = sourceId
        ? `action-${createHash("sha256")
            .update(`${workspaceId}\0${sourceId}\0${dedupeKey}`)
            .digest("hex")
            .slice(0, 32)}`
        : randomUUID();
      const existingAction = await manager.actionItem(workspaceId, id);
      if (existingAction && existingAction.title !== title) {
        throw new Error(
          `Action dedupeKey collision: ${dedupeKey} already belongs to "${existingAction.title}". Use one provider- or decision-scoped key per distinct action.`,
        );
      }
      const item = {
        id,
        agentId: value(body.agentId, "agentId", 120, false) ?? "chief",
        title,
        reason,
        sourceId,
        request: actionInputRequest(
          body.request,
          `${id}-request`,
          title,
          reason,
        ),
        status: "open" as const,
        createdAt: Date.now(),
      };
      await manager.raiseActionItem(workspaceId, item);
      return json({
        actionItem: item,
        instruction:
          "Action recorded. Continue every independent part of the current task and do not raise an equivalent action again.",
      });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
}

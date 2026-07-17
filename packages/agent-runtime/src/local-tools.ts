import { randomUUID } from "node:crypto";

import type { SessionManager } from "./manager.js";
import type {
  CampaignRecord,
  ContentDraftRecord,
  ProspectRecord,
  RecurringWorkRecord,
  TrendRecord,
} from "./types.js";
import {
  googleAnalyticsMetadata,
  googleAnalyticsProperties,
  googleAnalyticsRunReport,
} from "./google-analytics-local.js";
import { nextRunAt, validateCron } from "./recurring-work.js";
import {
  readWorkspaceContext,
  writeWorkspaceBrandProfile,
} from "./workspace-context.js";
import { workspaceSecrets } from "./workspace-secrets.js";

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
  return input.slice(0, maximum).map((item) => value(item, name, 300)!);
}

function googleAnalyticsFieldList(input: unknown, name: string) {
  if (!Array.isArray(input)) throw new Error(`${name} must be a list.`);
  return input.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "name" in item) {
      return value((item as { name?: unknown }).name, name, 200)!;
    }
    throw new Error(`${name} must contain field names.`);
  });
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
          summary: "Create or revise an editable workspace file",
          description:
            "Saves Markdown or plain text as a durable versioned file. Pass expectedVersionId when revising a file so a user's newer edits are never overwritten.",
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
      "/local-tools/attention": {
        post: {
          operationId: "attention.raise",
          summary:
            "Flag something that genuinely requires the user's attention",
          description:
            "Use sparingly: only for items the user must personally decide or act on. A concrete reason is required; routine output and successes must never be flagged.",
          requestBody: body("AttentionInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/brand-profile": {
        post: {
          operationId: "brandProfile.save",
          summary: "Save the workspace brand profile",
          description:
            "Stores a researched or user-supplied brand profile so every agent receives it in future sessions and runs.",
          requestBody: body("BrandProfileInput"),
          responses: saveResponse,
        },
      },
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
      "/local-tools/google-analytics/metadata": {
        post: {
          operationId: "googleAnalytics.metadata",
          summary: "Discover live GA4 metrics and dimensions",
          description:
            "Uses this Mac's existing Google Analytics login. Query by a concept such as conversion, landing page, acquisition, or revenue before building a report.",
          requestBody: body("GoogleAnalyticsMetadataInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/google-analytics/properties": {
        post: {
          operationId: "googleAnalytics.properties",
          summary: "List GA4 properties available on this Mac",
          description:
            "Uses this Mac's existing Google Analytics login to list the properties the user can report on.",
          requestBody: body("GoogleAnalyticsPropertiesInput"),
          responses: saveResponse,
        },
      },
      "/local-tools/google-analytics/report": {
        post: {
          operationId: "googleAnalytics.runReport",
          summary: "Run a live GA4 report from this Mac",
          description:
            "Builds and runs a live Google Analytics Data API request. Pass body fields directly as propertyId, startDate, endDate, metrics as strings, dimensions as strings, and limit. Do not wrap field names in name objects.",
          requestBody: body("GoogleAnalyticsReportInput"),
          responses: saveResponse,
        },
      },
    },
    components: {
      securitySchemes: {
        localWorkspaceCapability: { type: "http", scheme: "bearer" },
      },
      schemas: {
        AttentionInput: {
          type: "object",
          required: ["title", "reason"],
          properties: {
            title: { type: "string", maxLength: 200 },
            reason: {
              type: "string",
              minLength: 20,
              maxLength: 1000,
              description:
                "Why this needs the user personally: the decision to make or action to take, stated concretely.",
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
        ProspectInput: {
          type: "object",
          additionalProperties: false,
          required: ["name", "source", "summary"],
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
            sourceUrl: { type: "string" },
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
            sourceRunId: { type: "string" },
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
        GoogleAnalyticsMetadataInput: {
          type: "object",
          additionalProperties: false,
          required: ["propertyId"],
          properties: {
            propertyId: { type: "string" },
            query: {
              type: "string",
              description:
                "Optional concept used to narrow the GA4 metadata catalogue",
            },
          },
        },
        GoogleAnalyticsPropertiesInput: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        GoogleAnalyticsReportInput: {
          type: "object",
          additionalProperties: false,
          required: ["propertyId", "startDate", "endDate", "metrics"],
          properties: {
            propertyId: { type: "string" },
            startDate: { type: "string", examples: ["7daysAgo"] },
            endDate: { type: "string", examples: ["yesterday"] },
            metrics: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: { type: "string" },
            },
            dimensions: {
              type: "array",
              maxItems: 9,
              default: [],
              items: { type: "string" },
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 10000,
              default: 100,
            },
          },
        },
        RecurringWorkInput: {
          type: "object",
          additionalProperties: false,
          required: [
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
            runOnceAt: {
              oneOf: [{ type: "number" }, { type: "string" }],
              description:
                "Exact timestamp for a one-off task. Omit for recurring work.",
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

export async function handleLocalTool(
  request: Request,
  workspaceId: string,
  manager: SessionManager,
) {
  const path = new URL(request.url).pathname;
  const data = await manager.workspaceData(workspaceId);
  if (request.method === "GET") {
    if (path === "/local-tools/prospects")
      return json({ prospects: data.prospects });
    if (path === "/local-tools/trends") return json({ trends: data.trends });
    if (path === "/local-tools/content") return json({ drafts: data.drafts });
    if (path === "/local-tools/files") {
      return json({ files: await manager.listWorkspaceFiles(workspaceId) });
    }
    if (path === "/local-tools/campaigns") {
      return json({ campaigns: data.campaigns });
    }
    if (path === "/local-tools/brand-profile") {
      return json({ configured: Boolean(readWorkspaceContext(workspaceId)) });
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
    if (path === "/local-tools/google-analytics/properties") {
      const environment = await workspaceSecrets.materialize(workspaceId);
      return json(
        await googleAnalyticsProperties({
          credentialsPath: environment.GOOGLE_APPLICATION_CREDENTIALS,
        }),
      );
    }
    if (path === "/local-tools/google-analytics/metadata") {
      const environment = await workspaceSecrets.materialize(workspaceId);
      return json(
        await googleAnalyticsMetadata({
          propertyId: body.propertyId,
          query: body.query,
          credentialsPath: environment.GOOGLE_APPLICATION_CREDENTIALS,
        }),
      );
    }
    if (path === "/local-tools/google-analytics/report") {
      const environment = await workspaceSecrets.materialize(workspaceId);
      const dateRange = Array.isArray(body.dateRanges)
        ? (body.dateRanges[0] as Record<string, unknown> | undefined)
        : undefined;
      return json(
        await googleAnalyticsRunReport({
          propertyId: body.propertyId,
          startDate: body.startDate ?? dateRange?.startDate,
          endDate: body.endDate ?? dateRange?.endDate,
          metrics: googleAnalyticsFieldList(body.metrics, "metrics"),
          dimensions:
            body.dimensions === undefined
              ? []
              : googleAnalyticsFieldList(body.dimensions, "dimensions"),
          limit: body.limit,
          credentialsPath: environment.GOOGLE_APPLICATION_CREDENTIALS,
        }),
      );
    }
    if (path === "/local-tools/prospects") {
      const prospect: ProspectRecord = {
        id: value(body.id, "id", 120, false) ?? randomUUID(),
        name: value(body.name, "name", 160)!,
        company: value(body.company, "company", 160, false),
        source: value(body.source, "source", 120)!,
        sourceUrl: value(body.sourceUrl, "sourceUrl", 500, false),
        summary: value(body.summary, "summary", 2_000)!,
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
      const trend: TrendRecord = {
        id: value(body.id, "id", 120, false) ?? randomUUID(),
        title: value(body.title, "title", 200)!,
        source: value(body.source, "source", 120)!,
        sourceUrl: value(body.sourceUrl, "sourceUrl", 500, false),
        summary: value(body.summary, "summary", 2_000)!,
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
    if (path === "/local-tools/content") {
      const now = Date.now();
      const scheduledFor =
        body.scheduledFor === undefined ? undefined : time(body.scheduledFor);
      const id = value(body.id, "id", 120, false) ?? randomUUID();
      const title = value(body.title, "title", 200)!;
      const content = value(body.body, "body", 20_000)!;
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
          "cmo",
      });
      const draft: ContentDraftRecord = {
        id,
        agentId:
          value(body.agentId, "agentId", 80, false) ??
          existingDraft?.agentId ??
          "cmo",
        title,
        body: content,
        platform: value(body.platform, "platform", 80)!,
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
        sourceRunId: value(body.sourceRunId, "sourceRunId", 120, false),
      });
      return json({ file });
    }
    if (path === "/local-tools/campaigns") {
      const now = Date.now();
      const campaign: CampaignRecord = {
        id: value(body.id, "id", 120, false) ?? randomUUID(),
        name: value(body.name, "name", 200)!,
        provider: value(body.provider, "provider", 120)!,
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
      const markdown = value(body.markdown, "markdown", 20_000)!;
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
      const cron = value(body.cron, "cron", 120)!;
      const timezone = value(body.timezone, "timezone", 120)!;
      const runOnceAt =
        body.runOnceAt === undefined
          ? existing?.runOnceAt
          : time(body.runOnceAt, Number.NaN);
      if (runOnceAt !== undefined && !Number.isFinite(runOnceAt)) {
        throw new Error("runOnceAt must be a valid timestamp.");
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
      const agentId = value(body.agentId, "agentId", 120)!;
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
          scope = encoded ? JSON.parse(encoded) : [];
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
      const work: RecurringWorkRecord = {
        id,
        agentId,
        title: value(body.title, "title", 200)!,
        instructions: value(body.instructions, "instructions", 8_000)!,
        cron,
        timezone,
        runOnceAt,
        status: activate ? "active" : "draft",
        placement: "local",
        approvalSummary: value(body.approvalSummary, "approvalSummary", 2_000)!,
        proposedToolPatterns,
        grant: activate
          ? { version: 1, approvedAt: now, toolPatterns: proposedToolPatterns }
          : undefined,
        nextRunAt: activate
          ? runOnceAt !== undefined && runOnceAt <= now
            ? now
            : (runOnceAt ?? nextRunAt(cron, timezone))
          : undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await manager.saveRecurringWork(workspaceId, work);
      if (!activate) {
        // The proposal itself is the action item; agents must not raise a
        // second one by hand.
        await manager.raiseAttentionItem(workspaceId, {
          id: `attention-${work.id}-approval`,
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
    if (path === "/local-tools/attention") {
      const title = value(body.title, "title", 200)!;
      const reason = value(body.reason, "reason", 1_000)!;
      if (reason.trim().length < 20) {
        throw new Error(
          "A concrete reason is required: state the decision or action the user must take.",
        );
      }
      const item = {
        id: randomUUID(),
        agentId: value(body.agentId, "agentId", 120, false) ?? "cmo",
        title,
        reason,
        status: "open" as const,
        createdAt: Date.now(),
      };
      await manager.raiseAttentionItem(workspaceId, item);
      return json({ attentionItem: item });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
}

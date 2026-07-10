import { randomUUID } from "node:crypto";

import type { SessionManager } from "./manager.js";
import type {
  CampaignRecord,
  ContentDraftRecord,
  ProspectRecord,
  RecurringWorkRecord,
  TrendRecord,
} from "./types.js";
import { validateCron } from "./recurring-work.js";

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

function stringList(input: unknown, name: string, maximum = 30) {
  if (!Array.isArray(input)) throw new Error(`${name} must be a list.`);
  return input.slice(0, maximum).map((item) => value(item, name, 300)!);
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
      title: "Marketer Local Workspace Tools",
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
          requestBody: body("ContentInput"),
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
      "/local-tools/recurring-work": {
        get: {
          operationId: "recurringWork.list",
          summary: "List recurring agent work and approval state",
          responses: { "200": { description: "Workspace recurring work" } },
        },
        post: {
          operationId: "recurringWork.propose",
          summary: "Propose recurring agent work for user approval",
          description:
            "Creates a draft only. The user must explicitly approve it in Marketer before it can run.",
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
        ProspectInput: {
          type: "object",
          additionalProperties: false,
          required: ["name", "source", "summary"],
          properties: {
            id: { type: "string" },
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
            body: { type: "string" },
            platform: { type: "string" },
            status: {
              type: "string",
              enum: ["draft", "approved", "scheduled", "published"],
            },
            scheduledFor: { oneOf: [{ type: "number" }, { type: "string" }] },
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
            agentId: { type: "string" },
            title: { type: "string" },
            instructions: { type: "string" },
            cron: {
              type: "string",
              description: "Standard five-field cron expression",
            },
            timezone: { type: "string", description: "IANA timezone" },
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
    if (path === "/local-tools/campaigns") {
      return json({ campaigns: data.campaigns });
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
      const draft: ContentDraftRecord = {
        id: value(body.id, "id", 120, false) ?? randomUUID(),
        agentId: value(body.agentId, "agentId", 80, false) ?? "cmo",
        title: value(body.title, "title", 200)!,
        body: value(body.body, "body", 20_000)!,
        platform: value(body.platform, "platform", 80)!,
        status: choice(
          body.status,
          "status",
          ["draft", "approved", "scheduled", "published"],
          scheduledFor ? "scheduled" : "draft",
        ),
        scheduledFor,
        createdAt: now,
        updatedAt: now,
      };
      await manager.saveDraft(workspaceId, draft);
      return json({ draft });
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
    if (path === "/local-tools/recurring-work") {
      const now = Date.now();
      const cron = value(body.cron, "cron", 120)!;
      const timezone = value(body.timezone, "timezone", 120)!;
      validateCron(cron, timezone);
      const work: RecurringWorkRecord = {
        id: value(body.id, "id", 120, false) ?? randomUUID(),
        agentId: value(body.agentId, "agentId", 120)!,
        title: value(body.title, "title", 200)!,
        instructions: value(body.instructions, "instructions", 8_000)!,
        cron,
        timezone,
        status: "draft",
        placement: "local",
        approvalSummary: value(body.approvalSummary, "approvalSummary", 2_000)!,
        proposedToolPatterns: toolAddressList(body.proposedToolPatterns),
        createdAt: now,
        updatedAt: now,
      };
      await manager.saveRecurringWork(workspaceId, work);
      return json({ recurringWork: work, requiresUserApproval: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
}

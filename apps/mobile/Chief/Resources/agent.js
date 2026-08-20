const pendingTurnFrom = (messages) => {
  let lastAssistant = -1;
  let lastUser = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "assistant") lastAssistant = index;
    if (messages[index]?.role === "user") lastUser = index;
  }
  if (lastUser <= lastAssistant) return null;
  const message = messages[lastUser];
  return { content: message.content, at: message.at };
};

const browserEndReasons = new Set([
  "completed",
  "user-ended",
  "replaced",
  "unavailable",
]);

const validBrowserIdentifier = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);

const validBrowserRelease = (request) => {
  if (
    request?.version !== 1 ||
    !validBrowserIdentifier(request.releaseId) ||
    !validBrowserIdentifier(request.sessionId) ||
    !["completed", "waiting"].includes(request.outcome)
  )
    return false;
  if (
    request.label != null &&
    (typeof request.label !== "string" || request.label.length > 160)
  )
    return false;
  if (
    request.title != null &&
    (typeof request.title !== "string" || request.title.length > 256)
  )
    return false;
  if (request.url != null) {
    if (typeof request.url !== "string" || request.url.length > 2048)
      return false;
    if (
      !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(request.url) ||
      /^https?:\/\/[^/]*@/i.test(request.url)
    )
      return false;
  }
  return true;
};

const persistBrowserRelease = async (storage, messages, request) => {
  if (!validBrowserRelease(request)) {
    throw new Error("invalid browser session release request");
  }
  const receiptKey = `browser:release:${request.releaseId}`;
  const existingReceipt = await storage.get(receiptKey);
  if (existingReceipt) return existingReceipt;
  const receipt = {
    ...request,
    status: "released",
    releasedAt: new Date().toISOString(),
  };
  messages.push({
    role: "browser",
    content: JSON.stringify(receipt),
    at: Date.now(),
  });
  await storage.put(receiptKey, receipt);
  await storage.put("messages", messages);
  return receipt;
};

const persistBrowserEnd = async (storage, messages, request) => {
  if (
    request?.version !== 1 ||
    !validBrowserIdentifier(request.sessionId) ||
    !validBrowserIdentifier(request.clientInstanceId) ||
    !browserEndReasons.has(request.reason)
  ) {
    throw new Error("invalid browser session end request");
  }
  const receiptKey = `browser:end:${request.sessionId}`;
  const existingReceipt = await storage.get(receiptKey);
  if (existingReceipt) return existingReceipt;

  const receipt = {
    version: 1,
    sessionId: request.sessionId,
    status: "ended",
    reason: request.reason,
    endedAt: new Date().toISOString(),
  };
  messages.push({
    role: "browser",
    content: JSON.stringify(receipt),
    at: Date.now(),
  });
  await storage.put(receiptKey, receipt);
  await storage.put("messages", messages);
  return receipt;
};

const scopedConversationStorage = (storage, conversationId) => {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(conversationId)) {
    throw new Error("invalid conversation id");
  }
  const root = `conversation:${conversationId}:`;
  return {
    get: (key) => storage.get(`${root}${key}`),
    put: (key, value) => storage.put(`${root}${key}`, value),
    delete: (key) => storage.delete(`${root}${key}`),
    async list(options = {}) {
      const requestedPrefix = String(options.prefix ?? "");
      const entries = await storage.list({
        ...options,
        prefix: `${root}${requestedPrefix}`,
      });
      const scoped = new Map();
      for (const [key, value] of entries ?? []) {
        scoped.set(String(key).slice(root.length), value);
      }
      return scoped;
    },
  };
};

export class AgentCell extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const body = request.method === "POST" ? await request.json() : null;
    const conversationId = String(
      body?.conversationId ?? url.searchParams.get("conversationId") ?? "",
    ).trim();
    const storage = conversationId
      ? scopedConversationStorage(this.ctx.storage, conversationId)
      : this.ctx.storage;
    const messages = (await storage.get("messages")) ?? [];
    let pendingTurn = await storage.get("pendingTurn");

    // Preview routes: serve the project files the code-mode agent built.
    if (request.method === "GET") {
      if (path === "/files") {
        const list =
          (await storage.list({ prefix: "file:" })) ?? new Map();
        const files = {};
        for (const [k, v] of list) files[k.slice(5)] = v;
        return Response.json({ files });
      }
      if (path === "/files/names") {
        const list =
          (await storage.list({ prefix: "file:" })) ?? new Map();
        return Response.json({
          files: [...list.keys()].map((k) => k.slice(5)),
        });
      }
      return Response.json({
        messages,
        pending: Boolean(pendingTurn ?? pendingTurnFrom(messages)),
      });
    }

    if (request.method === "DELETE") {
      const stored = (await storage.list()) ?? new Map();
      for (const key of stored.keys()) {
        await storage.delete(key);
      }
      return Response.json({ messages: [] });
    }

    if (request.method === "POST" && path === "/browser/end") {
      let receipt;
      try {
        receipt = await persistBrowserEnd(storage, messages, body);
      } catch {
        return Response.json(
          { error: "invalid browser session end request" },
          { status: 400 },
        );
      }
      return Response.json({ messages, receipt });
    }

    // Chat / build flow.
    const resume = body.resume === true;
    const steer = body.steer === true;
    if (resume) {
      const unansweredTurn = pendingTurnFrom(messages);
      if (!unansweredTurn) {
        if (pendingTurn) await storage.delete("pendingTurn");
        return Response.json({ messages });
      }
      pendingTurn = pendingTurn ?? unansweredTurn;
      await storage.put("pendingTurn", pendingTurn);
    } else {
      const steeringMessages =
        steer && Array.isArray(body.messages)
          ? body.messages
              .map((value) => String(value ?? "").trim())
              .filter(Boolean)
          : [String(body.text ?? "").trim()].filter(Boolean);
      if (!steeringMessages.length) {
        return Response.json({ messages, error: "empty message" });
      }
      if (!steer && (pendingTurn || pendingTurnFrom(messages))) {
        return Response.json(
          { messages, error: "a turn is already pending" },
          { status: 409 },
        );
      }

      const startedAt = Date.now();
      for (const [index, content] of steeringMessages.entries()) {
        messages.push({
          role: "user",
          content,
          at: startedAt + index,
          conversationId,
        });
      }
      const userMsg = messages[messages.length - 1];
      pendingTurn = { content: userMsg.content, at: userMsg.at };
      await storage.put("messages", messages);
      await storage.put("pendingTurn", pendingTurn);
    }

    let reply = "";
    let tools = [];
    let reasoning = null;
    let activity = [];
    let steering = [];
    let failure = null;
    let failureCode = null;
    try {
      const result = await this.env.AI.respond(this.ctx.id.name, messages);
      try {
        const parsed = JSON.parse(result);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.reply === "string"
        ) {
          reply = parsed.reply;
          tools = Array.isArray(parsed.tools) ? parsed.tools : [];
          activity = Array.isArray(parsed.activity)
            ? parsed.activity.filter(
                (item) =>
                  item &&
                  (item.kind === "reasoning" || item.kind === "tool"),
              )
            : [];
          reasoning =
            parsed.reasoning &&
            typeof parsed.reasoning.text === "string" &&
            Number.isFinite(parsed.reasoning.durationMs)
              ? parsed.reasoning
              : null;
          steering = Array.isArray(parsed.steering)
            ? parsed.steering.filter(
                (input) =>
                  input &&
                  typeof input.id === "string" &&
                  typeof input.text === "string" &&
                  input.text.trim() &&
                  Number.isFinite(input.createdAtMs),
              )
            : [];
          failure =
            typeof parsed.error === "string" && parsed.error.trim()
              ? parsed.error.trim()
              : null;
          failureCode =
            typeof parsed.errorCode === "string" && parsed.errorCode.trim()
              ? parsed.errorCode.trim()
              : null;
        } else {
          reply = result;
        }
      } catch {
        reply = result;
      }
    } catch (e) {
      failure = String(e && e.message ? e.message : e);
    }

    if (activity.length) {
      const activityStartedAt = Date.now();
      for (const [index, item] of activity.entries()) {
        if (
          item.kind === "reasoning" &&
          item.reasoning &&
          typeof item.reasoning.text === "string" &&
          item.reasoning.text.trim()
        ) {
          messages.push({
            role: "reasoning",
            content: JSON.stringify(item.reasoning),
            at: activityStartedAt + index,
          });
        } else if (
          item.kind === "tool" &&
          item.tool &&
          typeof item.tool.name === "string"
        ) {
          messages.push({
            role: "tool",
            content: JSON.stringify(item.tool),
            at: activityStartedAt + index,
          });
        }
      }
    }
    if (
      !activity.length &&
      reasoning &&
      reasoning.text.trim()
    ) {
      messages.push({
        role: "reasoning",
        content: JSON.stringify(reasoning),
        at: Date.now(),
      });
    }

    for (const tool of tools) {
      if (!activity.length) {
        messages.push({
          role: "tool",
          content: JSON.stringify(tool),
          at: Date.now(),
        });
      }
      if (tool?.name === "browser_end" && tool.status === "completed") {
        try {
          const endRequest = JSON.parse(tool.output);
          await persistBrowserEnd(storage, messages, endRequest);
        } catch (error) {
          failure =
            failure ?? String(error && error.message ? error.message : error);
        }
      }
      if (tool?.name === "browser_release" && tool.status === "completed") {
        try {
          const releaseRequest = JSON.parse(tool.output);
          await persistBrowserRelease(
            storage,
            messages,
            releaseRequest,
          );
        } catch (error) {
          failure =
            failure ?? String(error && error.message ? error.message : error);
        }
      }
    }

    for (const input of steering) {
      if (messages.some((message) => message?.steeringId === input.id))
        continue;
      messages.push({
        role: "user",
        content: input.text.trim(),
        at: input.createdAtMs,
        steeringId: input.id,
      });
    }
    if (steering.length) {
      const latest = steering[steering.length - 1];
      pendingTurn = { content: latest.text.trim(), at: latest.createdAtMs };
      await storage.put("pendingTurn", pendingTurn);
    }

    if (failure) {
      await storage.put("messages", messages);
      return Response.json(
        { messages, error: failure, errorCode: failureCode },
        { status: 502 },
      );
    }

    const assistantMsg = { role: "assistant", content: reply, at: Date.now() };
    messages.push(assistantMsg);

    await storage.put("messages", messages);
    await storage.delete("pendingTurn");
    return Response.json({ messages });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "default";
    const stub = env.AGENT_CELL.getByName(name);
    return stub.fetch(request);
  },
};

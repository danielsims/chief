// The agent worker bundle. `ConversationAgent` is a Durable Object: each
// conversation is its own SQLite-backed cell. The agent has durable state, a
// private queryable database, and a sandboxed code executor (`code` tool). The
// coding-agent flavor can build small web apps whose files are stored durably
// in the cell and served back for preview.

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

const validTurnCheckpoint = (checkpoint) =>
  checkpoint?.version === 1 &&
  typeof checkpoint.id === "string" &&
  Number.isFinite(checkpoint.userAt) &&
  Number.isFinite(checkpoint.startedAtMs) &&
  Number.isFinite(checkpoint.updatedAtMs) &&
  typeof checkpoint.text === "string" &&
  typeof checkpoint.reasoning === "string" &&
  Array.isArray(checkpoint.tools);

const checkpointMessage = (checkpoint, kind, message) => ({
  ...message,
  checkpointId: checkpoint.id,
  checkpointKind: kind,
});

/// Return the recoverable stream as ordinary transcript-shaped records without
/// mutating durable history. This makes an interrupted turn visible as soon as
/// the cell wakes, while keeping the final transcript free of duplicates.
const materializeCheckpoint = (
  messages,
  checkpoint,
  { includeText = true } = {},
) => {
  if (!validTurnCheckpoint(checkpoint)) return messages;
  const materialized = [...messages];
  const hasKind = (kind) =>
    materialized.some(
      (message) =>
        message?.checkpointId === checkpoint.id &&
        message?.checkpointKind === kind,
    );
  if (Array.isArray(checkpoint.activities) && checkpoint.activities.length) {
    for (const activity of checkpoint.activities) {
      const kind = `activity:${String(activity?.id ?? "")}`;
      if (!activity || hasKind(kind)) continue;
      if (activity.kind === "reasoning") {
        const text = String(activity.reasoning ?? "").trim();
        if (!text) continue;
        materialized.push(
          checkpointMessage(checkpoint, kind, {
            role: "reasoning",
            content: JSON.stringify({
              text,
              durationMs: Math.max(
                0,
                Number(activity.updatedAtMs ?? 0) -
                  Number(activity.startedAtMs ?? 0),
              ),
            }),
            at: activity.startedAtMs,
          }),
        );
      } else if (activity.kind === "tool") {
        const tool = checkpoint.tools.find(
          (candidate) => candidate?.id === activity.toolID,
        );
        if (!tool) continue;
        materialized.push(
          checkpointMessage(checkpoint, kind, {
            role: "tool",
            content: JSON.stringify(tool),
            at: activity.startedAtMs,
          }),
        );
      } else if (activity.kind === "steering") {
        const text = String(activity.reasoning ?? "").trim();
        const steeringId = String(activity.steeringID ?? activity.id ?? "");
        if (!text || !steeringId) continue;
        materialized.push(
          checkpointMessage(checkpoint, kind, {
            role: "user",
            content: text,
            at: activity.startedAtMs,
            steeringId,
          }),
        );
      }
    }
  } else {
    if (checkpoint.reasoning.trim() && !hasKind("reasoning")) {
      materialized.push(
        checkpointMessage(checkpoint, "reasoning", {
          role: "reasoning",
          content: JSON.stringify({
            text: checkpoint.reasoning.trim(),
            durationMs: Math.max(0, checkpoint.reasoningDurationMs ?? 0),
          }),
          at: checkpoint.startedAtMs,
        }),
      );
    }
    for (const tool of checkpoint.tools) {
      const kind = `tool:${String(tool?.id ?? "")}`;
      if (!tool || hasKind(kind)) continue;
      materialized.push(
        checkpointMessage(checkpoint, kind, {
          role: "tool",
          content: JSON.stringify(tool),
          at: checkpoint.updatedAtMs,
        }),
      );
    }
  }
  if (includeText && checkpoint.text.trim() && !hasKind("assistant")) {
    materialized.push(
      checkpointMessage(checkpoint, "assistant", {
        role: "assistant-partial",
        content: checkpoint.text,
        at: checkpoint.updatedAtMs,
      }),
    );
  }
  return materialized;
};

const sealCheckpoint = async (storage, messages, checkpoint) => {
  if (!validTurnCheckpoint(checkpoint)) return false;
  const sealed = materializeCheckpoint(messages, checkpoint);
  messages.splice(0, messages.length, ...sealed);
  await storage.put("messages", messages);
  await storage.delete("activeTurn");
  return true;
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

export class ConversationAgent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const messages = (await this.ctx.storage.get("messages")) ?? [];
    let pendingTurn = await this.ctx.storage.get("pendingTurn");
    let activeTurn = await this.ctx.storage.get("activeTurn");

    // Preview routes: serve the project files the code-mode agent built.
    if (request.method === "GET") {
      if (path === "/files") {
        const list =
          (await this.ctx.storage.list({ prefix: "file:" })) ?? new Map();
        const files = {};
        for (const [k, v] of list) files[k.slice(5)] = v;
        return Response.json({ files });
      }
      if (path === "/files/names") {
        const list =
          (await this.ctx.storage.list({ prefix: "file:" })) ?? new Map();
        return Response.json({
          files: [...list.keys()].map((k) => k.slice(5)),
        });
      }
      return Response.json({
        messages: materializeCheckpoint(messages, activeTurn),
        pending: Boolean(pendingTurn ?? pendingTurnFrom(messages)),
      });
    }

    if (request.method === "DELETE") {
      const stored = (await this.ctx.storage.list()) ?? new Map();
      for (const key of stored.keys()) {
        await this.ctx.storage.delete(key);
      }
      return Response.json({ messages: [] });
    }

    if (request.method === "POST" && path === "/browser/end") {
      const body = await request.json();
      let receipt;
      try {
        receipt = await persistBrowserEnd(this.ctx.storage, messages, body);
      } catch {
        return Response.json(
          { error: "invalid browser session end request" },
          { status: 400 },
        );
      }
      return Response.json({ messages, receipt });
    }

    // Chat / build flow.
    const body = await request.json();
    const resume = body.resume === true;
    const steer = body.steer === true;
    if (resume) {
      // Tool records are deliberately persisted after their user message. A
      // pending turn therefore cannot be identified by looking only at the
      // final message role. Keep an explicit marker and recover older cells by
      // comparing the most recent user and assistant positions.
      const unansweredTurn = pendingTurnFrom(messages);
      if (!unansweredTurn) {
        if (pendingTurn) await this.ctx.storage.delete("pendingTurn");
        return Response.json({ messages });
      }
      pendingTurn = pendingTurn ?? unansweredTurn;
      await this.ctx.storage.put("pendingTurn", pendingTurn);
      // A checkpoint left by a crashed or failed host callback belongs in the
      // permanent transcript before this attempt starts a fresh checkpoint.
      if (activeTurn) {
        await sealCheckpoint(this.ctx.storage, messages, activeTurn);
        activeTurn = null;
      }
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

      // Steering supersedes an interrupted request after its native callback
      // has unwound. Preserve the sealed reasoning/tool history, then append
      // every queued user instruction in order; the final message becomes the
      // new trigger while the earlier ones remain verbatim conversation
      // context. A normal POST still rejects overlapping pending work.
      if (steer && activeTurn) {
        await sealCheckpoint(this.ctx.storage, messages, activeTurn);
        activeTurn = null;
      }
      const startedAt = Date.now();
      for (const [index, content] of steeringMessages.entries()) {
        messages.push({ role: "user", content, at: startedAt + index });
      }
      const userMsg = messages[messages.length - 1];
      pendingTurn = { content: userMsg.content, at: userMsg.at };
      // Persist intent before inference. A resume request reuses this exact
      // durable user message rather than adding a synthetic “Continue”.
      await this.ctx.storage.put("messages", messages);
      await this.ctx.storage.put("pendingTurn", pendingTurn);
    }

    let reply = "";
    let tools = [];
    let reasoning = null;
    let steering = [];
    let failure = null;
    try {
      const result = await this.env.AI.respond(this.ctx.id.name, messages);
      // The AI bridge returns a JSON envelope {reply, tools}. Fall back to
      // treating the raw string as the reply if it isn't parseable.
      try {
        const parsed = JSON.parse(result);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.reply === "string"
        ) {
          reply = parsed.reply;
          tools = Array.isArray(parsed.tools) ? parsed.tools : [];
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
        } else {
          reply = result;
        }
      } catch {
        reply = result;
      }
    } catch (e) {
      failure = String(e && e.message ? e.message : e);
    }

    // Native inference updates this key directly while the Worker isolate is
    // synchronously awaiting AI.respond(), so refresh it after the callback.
    activeTurn = await this.ctx.storage.get("activeTurn");

    const checkpointOwnsTranscript = validTurnCheckpoint(activeTurn);
    const checkpointOwnsFailure = Boolean(failure && checkpointOwnsTranscript);
    if (!failure && checkpointOwnsTranscript) {
      const materialized = materializeCheckpoint(messages, activeTurn, {
        includeText: false,
      });
      messages.splice(0, messages.length, ...materialized);
    }
    if (!checkpointOwnsTranscript && reasoning && reasoning.text.trim()) {
      messages.push({
        role: "reasoning",
        content: JSON.stringify(reasoning),
        at: Date.now(),
      });
    }

    // Persist the tool calls that produced this reply so the thread shows the
    // agent's work before the final answer, matching the live streaming turn.
    for (const tool of tools) {
      if (!checkpointOwnsTranscript) {
        messages.push({
          role: "tool",
          content: JSON.stringify(tool),
          at: Date.now(),
        });
      }
      if (tool?.name === "browser_end" && tool.status === "completed") {
        try {
          const endRequest = JSON.parse(tool.output);
          await persistBrowserEnd(this.ctx.storage, messages, endRequest);
        } catch (error) {
          failure =
            failure ?? String(error && error.message ? error.message : error);
        }
      }
      if (tool?.name === "browser_release" && tool.status === "completed") {
        try {
          const releaseRequest = JSON.parse(tool.output);
          await persistBrowserRelease(
            this.ctx.storage,
            messages,
            releaseRequest,
          );
        } catch (error) {
          failure =
            failure ?? String(error && error.message ? error.message : error);
        }
      }
    }

    // Steering is admitted separately while the provider turn is active and
    // promoted only after the native loop has consumed it. Materialize each
    // instruction exactly once before the assistant's terminal response.
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
      await this.ctx.storage.put("pendingTurn", pendingTurn);
    }

    if (failure) {
      // Keep the unanswered user intent durable, but do not fossilize a
      // transient provider/transport failure as an assistant message. The UI
      // can now present a retry state and resume this exact request.
      if (checkpointOwnsFailure) {
        await sealCheckpoint(this.ctx.storage, messages, activeTurn);
      } else {
        await this.ctx.storage.delete("activeTurn");
      }
      await this.ctx.storage.put("messages", messages);
      return Response.json({ messages, error: failure }, { status: 502 });
    }

    const assistantMsg = { role: "assistant", content: reply, at: Date.now() };
    messages.push(assistantMsg);

    await this.ctx.storage.put("messages", messages);
    await this.ctx.storage.delete("activeTurn");
    await this.ctx.storage.delete("pendingTurn");
    return Response.json({ messages });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "default";
    const stub = env.CONVERSATION_AGENT.getByName(name);
    return stub.fetch(request);
  },
};

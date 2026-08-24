export class AgentCell extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const body =
      request.method === "POST" || request.method === "PUT"
        ? await request.json()
        : null;
    if (path === "/snapshot" && request.method === "GET") {
      const entries = (await this.ctx.storage.list()) ?? new Map();
      return Response.json({
        version: 1,
        cellId: this.ctx.id.name,
        exportedAt: new Date().toISOString(),
        records: [...entries].slice(0, 1000).map(([key, value]) => ({
          key: String(key),
          value,
        })),
      });
    }
    if (path === "/snapshot" && request.method === "PUT") {
      if (
        body?.version !== 1 ||
        body?.cellId !== this.ctx.id.name ||
        !Array.isArray(body?.records) ||
        body.records.length > 1000 ||
        body.records.some(
          (record) =>
            !record ||
            typeof record.key !== "string" ||
            !record.key.trim() ||
            record.key.length > 320,
        )
      ) {
        return Response.json(
          { error: "invalid cell snapshot" },
          { status: 400 },
        );
      }
      const current = (await this.ctx.storage.list()) ?? new Map();
      for (const key of current.keys()) await this.ctx.storage.delete(key);
      for (const record of body.records) {
        await this.ctx.storage.put(record.key, record.value);
      }
      return Response.json({ ok: true, imported: body.records.length });
    }
    const conversationId = String(
      body?.conversationId ?? url.searchParams.get("conversationId") ?? "",
    ).trim();
    const storage = conversationId
      ? scopedConversationStorage(this.ctx.storage, conversationId)
      : this.ctx.storage;
    const messages = (await storage.get("messages")) ?? [];
    let pendingTurn = await storage.get("pendingTurn");
    let session = await ensureSession(
      storage,
      conversationId,
      this.ctx.id.name,
    );
    const initialMessageCount = messages.length;

    // Preview routes: serve the project files the code-mode agent built.
    if (request.method === "GET") {
      if (path === "/files") {
        const list = (await storage.list({ prefix: "file:" })) ?? new Map();
        const files = {};
        for (const [k, v] of list) files[k.slice(5)] = v;
        return Response.json({ files });
      }
      if (path === "/files/names") {
        const list = (await storage.list({ prefix: "file:" })) ?? new Map();
        return Response.json({
          files: [...list.keys()].map((k) => k.slice(5)),
        });
      }
      return Response.json({
        messages,
        pending: Boolean(pendingTurn ?? pendingTurnFrom(messages)),
        state: {
          sessionId: session.sessionId,
          streamIndex: session.streamIndex,
          status: session.status,
        },
      });
    }

    if (request.method === "DELETE") {
      const stored = (await storage.list()) ?? new Map();
      for (const key of stored.keys()) {
        await storage.delete(key);
      }
      return Response.json({ messages: [], resetSessionId: session.sessionId });
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
      const activeTurn = await storage.get("activeTurn");
      if (validTurnCheckpoint(activeTurn)) {
        materializeCheckpoint(messages, activeTurn);
        await storage.put("messages", messages);
        await storage.delete("activeTurn");
      }
      const unansweredTurn = pendingTurnFrom(messages);
      if (!unansweredTurn) {
        if (pendingTurn) await storage.delete("pendingTurn");
        session = await updateSession(
          storage,
          session,
          "waiting",
          messages.length - initialMessageCount,
        );
        return Response.json({ messages, state: session });
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
    session = await updateSession(storage, session, "running");

    let reply = "";
    let tools = [];
    let reasoning = null;
    let activity = [];
    let steering = [];
    let failure = null;
    let failureCode = null;
    try {
      const continuity = await agentContinuityMessage(
        this.ctx.storage,
        conversationId,
      );
      const inferenceMessages = continuity
        ? [continuity, ...messages]
        : messages;
      const result = await this.env.AI.respond(
        this.ctx.id.name,
        inferenceMessages,
      );
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
                  item && (item.kind === "reasoning" || item.kind === "tool"),
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
    if (!activity.length && reasoning && reasoning.text.trim()) {
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
          await persistBrowserRelease(storage, messages, releaseRequest);
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
      session = await updateSession(
        storage,
        session,
        "failed",
        messages.length - initialMessageCount,
      );
      return Response.json(
        { messages, error: failure, errorCode: failureCode, state: session },
        { status: 502 },
      );
    }

    const completedUserTurn = pendingTurn ?? pendingTurnFrom(messages);
    const assistantMsg = {
      role: "assistant",
      content: reply,
      at: Date.now(),
      conversationId,
    };
    messages.push(assistantMsg);

    await storage.put("messages", messages);
    await appendAgentJournal(
      this.ctx.storage,
      conversationId,
      completedUserTurn,
      assistantMsg,
      tools,
    );
    await storage.delete("pendingTurn");
    await storage.delete("activeTurn");
    session = await updateSession(
      storage,
      session,
      "waiting",
      messages.length - initialMessageCount,
    );
    return Response.json({ messages, state: session });
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

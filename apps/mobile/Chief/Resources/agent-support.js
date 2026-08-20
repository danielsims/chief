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

const validTurnCheckpoint = (checkpoint) =>
  checkpoint?.version === 1 &&
  typeof checkpoint.id === "string" &&
  typeof checkpoint.sessionId === "string" &&
  typeof checkpoint.turnId === "string" &&
  Number.isFinite(checkpoint.userAt) &&
  Array.isArray(checkpoint.activities);

const checkpointMessage = (checkpoint, kind, message) => ({
  ...message,
  checkpointId: checkpoint.id,
  checkpointKind: kind,
  turnId: checkpoint.turnId,
  sessionId: checkpoint.sessionId,
});

const materializeCheckpoint = (messages, checkpoint) => {
  if (!validTurnCheckpoint(checkpoint)) return messages;
  const has = (kind, id) =>
    messages.some(
      (message) =>
        message?.checkpointId === checkpoint.id &&
        message?.checkpointKind === kind &&
        message?.activityId === id,
    );
  for (const activity of checkpoint.activities) {
    if (
      activity?.kind === "reasoning" &&
      activity.text?.trim() &&
      !has("reasoning", activity.id)
    ) {
      messages.push(
        checkpointMessage(checkpoint, "reasoning", {
          role: "reasoning",
          activityId: activity.id,
          content: JSON.stringify({
            text: activity.text.trim(),
            status: activity.status,
            durationMs: Math.max(
              0,
              activity.updatedAtMs - activity.startedAtMs,
            ),
          }),
          at: activity.startedAtMs,
        }),
      );
    }
    if (
      activity?.kind === "tool" &&
      activity.tool &&
      !has("tool", activity.id)
    ) {
      messages.push(
        checkpointMessage(checkpoint, "tool", {
          role: "tool",
          activityId: activity.id,
          content: JSON.stringify({
            ...activity.tool,
            status: activity.status,
          }),
          at: activity.startedAtMs,
        }),
      );
    }
  }
  return messages;
};

const ensureSession = async (storage, conversationId, cellName) => {
  const sessionId = `${cellName}:${conversationId}`;
  const existing = await storage.get("session");
  if (existing?.version === 1 && existing.sessionId === sessionId)
    return existing;
  const session = {
    ...(existing?.version === 1 ? existing : {}),
    version: 1,
    sessionId,
    conversationId,
    streamIndex: Number.isFinite(existing?.streamIndex)
      ? existing.streamIndex
      : 0,
    status: typeof existing?.status === "string" ? existing.status : "waiting",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await storage.put("session", session);
  return session;
};

const updateSession = async (storage, session, status, addedEvents = 0) => {
  const next = {
    ...session,
    streamIndex: session.streamIndex + addedEvents,
    status,
    updatedAt: new Date().toISOString(),
  };
  await storage.put("session", next);
  return next;
};

export const relayCellToolRequirements: Record<string, string> = {
  relay_channels_list: "channels.read",
  relay_messages_list: "messages.read",
  relay_thread_replies: "messages.read",
  relay_message_search: "messages.read",
  relay_message_post: "messages.send",
  relay_reaction_add: "messages.send",
  relay_reaction_remove: "messages.send",
  relay_workspace_members: "members.read",
  relay_channels_create: "channels.create",
  relay_channels_members_add: "members.manage",
  brand_profile_save: "brand-profile-write",
  brand_profile_get: "workspace.read",
  prospects_list: "workspace.read",
  prospects_save: "prospects-write",
  workspace_files_list: "workspace.read",
  workspace_files_save: "workspace.write",
  relay_projects_list: "projects.read",
  plugins_list: "workspace.read",
  plugins_recommend: "messages.send",
  plugins_install: "integrations.manage",
  plugins_authorize: "integrations.manage",
  plugins_uninstall: "integrations.manage",
  browser_navigate: "browser.use",
  browser_snapshot: "browser.use",
  browser_click: "browser.use",
  browser_type: "browser.use",
  browser_scroll: "browser.use",
  browser_back: "browser.use",
  browser_release: "browser.use",
};

export const relayCellToolDefinitions = [
  {
    name: "relay_channels_list",
    description: "List the workspace conversations this agent can address.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "relay_messages_list",
    description: "Read recent messages from a workspace conversation.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        after: { type: "integer" },
      },
      required: ["conversationId"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_thread_replies",
    description: "Read the replies to a root message in a thread.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        rootMessageId: { type: "string" },
        after: { type: "integer" },
      },
      required: ["conversationId", "rootMessageId"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_message_search",
    description: "Search prior messages in one workspace conversation.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        query: { type: "string" },
      },
      required: ["conversationId", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_message_post",
    description:
      "Post a message as this agent. Supply a stable idempotencyKey for durable workflow messages.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        body: { type: "string" },
        threadRootId: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["conversationId", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_reaction_add",
    description: "Add an emoji reaction to a workspace message.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        messageId: { type: "string" },
        emoji: { type: "string" },
      },
      required: ["conversationId", "messageId", "emoji"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_reaction_remove",
    description: "Remove this agent's emoji reaction from a workspace message.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        messageId: { type: "string" },
        emoji: { type: "string" },
      },
      required: ["conversationId", "messageId", "emoji"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_workspace_members",
    description: "List users and agents in this workspace.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "relay_channels_create",
    description:
      "Create an agent-owned channel. Reuse an existing channel with the same id.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        name: { type: "string" },
        isPrivate: { type: "boolean" },
      },
      required: ["conversationId", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_channels_members_add",
    description:
      "Add one or several users or agents to a channel in one operation.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        kind: { type: "string", enum: ["user", "agent"] },
        principalId: { type: "string" },
        principalIds: { type: "array", items: { type: "string" } },
      },
      required: ["conversationId", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "brand_profile_save",
    description:
      "Persist an evidence-backed Markdown brand profile with its direct source URLs.",
    inputSchema: {
      type: "object",
      properties: {
        markdown: { type: "string" },
        sourceUrls: { type: "array", items: { type: "string" } },
        conversationId: { type: "string" },
      },
      required: ["markdown", "sourceUrls", "conversationId"],
      additionalProperties: false,
    },
  },
  {
    name: "brand_profile_get",
    description: "Read the current shared workspace brand profile.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "prospects_list",
    description: "List prospects already saved in this workspace.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "prospects_save",
    description:
      "Persist one verified prospect. Include direct evidence and source URLs in the record.",
    inputSchema: {
      type: "object",
      properties: { prospect: { type: "object" } },
      required: ["prospect"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_files_list",
    description: "List visible versioned files in this workspace.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "workspace_files_save",
    description:
      "Create or update a versioned workspace file. Pass expectedVersion when replacing an existing file.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        path: { type: "string" },
        title: { type: "string" },
        mimeType: { type: "string" },
        content: { type: "string" },
        conversationId: { type: "string" },
        expectedVersion: { type: "integer", minimum: 1 },
      },
      required: ["path", "title", "mimeType", "content", "conversationId"],
      additionalProperties: false,
    },
  },
  {
    name: "relay_projects_list",
    description:
      "List the workspace project registry. Repository paths are deliberately cell-local and never returned.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "plugins_list",
    description:
      "Search the portable plugin catalog available to this agent cell.",
    inputSchema: {
      type: "object",
      properties: { refresh: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "plugins_recommend",
    description:
      "Present real clickable plugin cards in a relay conversation. Use this whenever the user asks to see, choose, connect, or install supported plugins; do not replace the cards with a prose-only list.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        threadRootId: { type: "string" },
        pluginIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 8,
        },
        rationale: { type: "string", maxLength: 1000 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 80 },
      },
      required: ["conversationId", "pluginIds", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "plugins_install",
    description:
      "Install a portable plugin into this agent's isolated cell after the user has asked to connect it.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        trusted: { type: "boolean" },
      },
      required: ["pluginId", "trusted"],
      additionalProperties: false,
    },
  },
  {
    name: "plugins_authorize",
    description:
      "Begin provider authorization for an installed plugin and post the safe native authorization card into the exact relay conversation.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        conversationId: { type: "string" },
        threadRootId: { type: "string" },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 80 },
      },
      required: ["pluginId", "conversationId", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "plugins_uninstall",
    description: "Remove a plugin package and its connection from this cell.",
    inputSchema: {
      type: "object",
      properties: { pluginId: { type: "string" } },
      required: ["pluginId"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_navigate",
    description:
      "Open a public HTTPS URL in this cell's isolated browser. Snapshot it before drawing conclusions.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        activityLabel: { type: "string" },
      },
      required: ["url", "activityLabel"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Read the current page as a compact semantic snapshot with stable element refs.",
    inputSchema: {
      type: "object",
      properties: { activityLabel: { type: "string" } },
      required: ["activityLabel"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_click",
    description: "Click a stable element ref from the latest browser snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        activityLabel: { type: "string" },
      },
      required: ["target", "activityLabel"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_type",
    description:
      "Replace the value of an editable snapshot ref and optionally submit it.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean" },
        activityLabel: { type: "string" },
      },
      required: ["target", "text", "activityLabel"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the current page and return a fresh snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "integer", minimum: 1, maximum: 10000 },
        activityLabel: { type: "string" },
      },
      required: ["direction", "amount", "activityLabel"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_back",
    description: "Go back one page in this cell's isolated browser.",
    inputSchema: {
      type: "object",
      properties: { activityLabel: { type: "string" } },
      required: ["activityLabel"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_release",
    description:
      "Release browser control after verified work. Use waiting only for a genuine human handoff.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["completed", "waiting"] },
        label: { type: "string" },
      },
      required: ["outcome"],
      additionalProperties: false,
    },
  },
] as const;

import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";

import { findClaudeCode } from "./drivers/claude-code-path.js";

export interface ClaudeCodeModel {
  value: string;
  label: string;
  description: string;
}

const LOOKUP_TIMEOUT_MS = 20_000;

let cached: Promise<ClaudeCodeModel[]> | null = null;

/**
 * The models this computer's Claude Code offers, read from Claude Code itself
 * so the list never needs maintaining. A session is opened only long enough
 * to ask, and the answer is kept for the life of the process.
 */
export function listClaudeCodeModels() {
  cached ??= readClaudeCodeModels().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

async function readClaudeCodeModels(): Promise<ClaudeCodeModel[]> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), LOOKUP_TIMEOUT_MS);
  // Streaming input keeps the session open without sending a prompt; it
  // simply ends when the lookup does.
  const idle: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          abortController.signal.addEventListener("abort", () =>
            resolve({ done: true, value: undefined }),
          );
        }),
    }),
  };
  const claudeCode = findClaudeCode();
  const session = query({
    prompt: idle,
    options: {
      abortController,
      ...(claudeCode ? { pathToClaudeCodeExecutable: claudeCode } : undefined),
    },
  });
  try {
    const models = await session.supportedModels();
    return models.map((model) => ({
      value: model.value,
      label: model.displayName,
      description: model.description,
    }));
  } finally {
    clearTimeout(timer);
    abortController.abort();
  }
}

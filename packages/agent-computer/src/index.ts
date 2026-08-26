export interface AgentComputerEntry {
  path: string;
  kind: "directory" | "file" | "symlink";
  size: number;
}

export interface AgentComputerExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentBrowserSnapshot {
  url: string;
  title: string;
  text: string;
  controls: string[];
}

export interface AgentBrowserTarget {
  ref?: string;
  labels?: string[];
}

export interface AgentBrowserStream {
  streamUrl: string;
  expiresAt: string;
}

export interface AgentBrowser {
  open(
    url: string,
    options?: { fresh?: boolean },
  ): Promise<AgentBrowserSnapshot>;
  snapshot(): Promise<AgentBrowserSnapshot>;
  click(target: AgentBrowserTarget): Promise<AgentBrowserSnapshot>;
  type(target: AgentBrowserTarget, text: string): Promise<AgentBrowserSnapshot>;
  select(
    target: AgentBrowserTarget,
    values: readonly string[],
  ): Promise<AgentBrowserSnapshot>;
  screenshot(): Promise<Uint8Array>;
  stream?(): Promise<AgentBrowserStream>;
  close(): Promise<void>;
}

export interface AgentInference {
  readonly model?: AgentInferenceModel;
  estimateTokens?(input: AgentInferenceRequest): number;
  complete(input: AgentInferenceRequest): Promise<AgentInferenceResult>;
}

export interface AgentInferenceModel {
  id: string;
  contextWindowTokens: number;
  maxOutputTokens?: number;
  limitSource: "provider" | "model_catalog" | "adapter_fallback";
}

export interface AgentInferenceRequest {
  messages: readonly AgentInferenceMessage[];
  tools: readonly AgentInferenceTool[];
  maxTokens: number;
  temperature: number;
}

export interface AgentInferenceResult {
  content: string | null;
  toolCalls: AgentInferenceToolCall[];
}

export interface AgentInferenceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: AgentInferenceToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface AgentInferenceTool {
  name: string;
  description: string;
  parameters: object;
}

export interface AgentInferenceToolCall {
  id: string;
  name: string;
  arguments: string | object;
}

export interface AgentComputer {
  readonly backend: string;

  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  editText(
    path: string,
    oldText: string,
    newText: string,
    replaceAll?: boolean,
  ): Promise<{ replacements: number }>;
  list(path: string): Promise<AgentComputerEntry[]>;
  remove(path: string, recursive?: boolean): Promise<void>;
  execute(command: string, cwd?: string): Promise<AgentComputerExecution>;
  git(argv: string[], cwd?: string): Promise<AgentComputerExecution>;
}

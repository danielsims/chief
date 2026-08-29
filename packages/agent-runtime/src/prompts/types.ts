/** Shared types and selectors for the atomic prompt parts. */

/** Stable, `JSON`-free helpers shared by every part module. */
export type PromptConversationKind = "channel" | "direct";

/** Workspace operating mode, mirrored from runtime-domain-types. */
export type PromptOperatingMode = "mission-control" | "channels" | "calm";

export interface PromptContext {
  /** Agent identity + capabilities already composed into persona text. */
  readonly identity: string;
  /** Exact capabilities granted to this agent identity. */
  readonly capabilities?: readonly string[];
  /** Exact tool permissions granted to this agent identity. */
  readonly permissions?: readonly string[];
  readonly deployment: "phone" | "desktop" | "cloud";
  readonly conversationKind?: PromptConversationKind;
  readonly channel?: { readonly isPrivate?: boolean };
  readonly operatingMode?: PromptOperatingMode;
  /** Workspace ground truth (name, website, selected apps, brand context). */
  readonly workspaceContext?: string;
  /**
   * When true, every part is included regardless of its gate. Used by the
   * legacy `composeWorkspaceInstructions` wrapper so an uncontextualised
   * system prompt keeps every shared rule (preserving prior behaviour).
   */
  readonly includeAll?: boolean;
}

export function hasPermission(ctx: PromptContext, permission: string) {
  return ctx.permissions?.includes(permission) ?? false;
}

export function hasCapability(ctx: PromptContext, capability: string) {
  return ctx.capabilities?.includes(capability) ?? false;
}

export const always = () => true;

export interface PromptPart {
  /** Stable id used for diagnostics and tests. */
  id: string;
  /** One-line description of the rule, for the assembly report. */
  summary: string;
  /** Returns true when this part belongs in the assembled prompt. */
  when: (ctx: PromptContext) => boolean;
  /** The instruction text (written as a self-contained rule). */
  render: () => string;
}

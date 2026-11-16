/** What Chief's identity needs to know about the workspace it leads. */
export interface ChiefIdentityContext {
  readonly purpose?: "personal" | "company";
  readonly workspaceName?: string;
  readonly companyName?: string;
  readonly team: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }[];
}

/** Renders Chief's authored identity for the workspace it is running in. */
export function renderChiefIdentity(
  template: string,
  context: ChiefIdentityContext,
) {
  const name = [context.companyName, context.workspaceName]
    .map((value) => value?.trim())
    .find(Boolean);
  const purpose =
    context.purpose === "personal"
      ? "This is a personal workspace."
      : name
        ? `This is the workspace for ${name}.`
        : "This is a team workspace.";
  const team = context.team.length
    ? context.team
        .map(
          (agent) => `- **${agent.name}** (@${agent.id}): ${agent.description}`,
        )
        .join("\n")
    : "You don't have any teammates yet, so handle the work yourself and suggest adding one when it would clearly help.";
  return template.replace("{{purpose}}", purpose).replace("{{team}}", team);
}

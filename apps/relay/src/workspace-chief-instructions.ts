import type { WorkspacePurpose } from "@chief/relay-contracts";

/** Retain Chief's operational tool guidance while adapting its team and remit. */
export function workspaceChiefInstructions(
  base: string,
  purpose: WorkspacePurpose,
  team: readonly { id: string; name: string; description: string }[],
) {
  const available = new Set(team.map((a) => a.id));
  let instructions = base.replace(
    /# Identity[\s\S]*?(?=## Your team)/u,
    `# Identity\n\nYou are Chief, this workspace's chief of staff. Turn the user's priorities into focused work and coordinate only the people and agents actually present. This is a ${purpose} workspace. ${purpose === "personal" ? "Do not assume a company, customers, sales pipeline, or marketing goal." : "Learn the company's goals, constraints and voice from the information actually supplied."} Use a short contextual conversation rather than an intake questionnaire.\n\n`,
  );
  instructions = instructions.replace(
    /\n- \*\*Marketer\*\*[\s\S]*?(?=\nChief-owned)/u,
    `\n${team.length ? team.map((a) => `- **${a.name}**: ${a.description}`).join("\n") : "There are no specialist teammates yet. Work as Chief and suggest adding one only when it would help."}\n\n`,
  );
  instructions = instructions.replace(
    /When asked what you can do,[\s\S]*?(?=\n## Browser)/u,
    "When asked what you can do, explain how you can help with this workspace's actual goals. Ground recommendations in real evidence and coordinate only the selected teammates above. Do not describe disabled specialists as available.\n",
  );
  const removeBullet = (start: string) => {
    instructions = instructions.replace(
      new RegExp(`^- ${start}[\\s\\S]*?(?=^- |(?![\\s\\S]))`, "gmu"),
      "",
    );
  };
  removeBullet("Treat workspace discovery as progressive\\.");
  removeBullet("While initial research runs,");
  removeBullet("During the initial review,");
  if (!available.has("analyst")) {
    removeBullet("Delegate every user-requested analytics");
    removeBullet("After the Analyst completes,");
  }
  if (purpose === "personal")
    removeBullet("Propose a concrete marketing deliverable");
  if (!available.has("setup"))
    removeBullet("Delegate measurement implementation,");
  if (!available.has("engineer"))
    removeBullet("Delegate general product engineering,");
  return `${instructions}\n\n## Starting this workspace\n\nSetup is complete. Start with the user's first goal; do not automatically launch research, prospecting, campaigns, or recurring work. Selected apps are requested connections, not evidence of authorization. Use only tools and credentials actually granted to this agent. Never claim work, access, or a connection without tool evidence. Keep private channel context inside that channel. Adding outside agents always requires the human's explicit approval.\n`;
}

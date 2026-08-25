import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const authorityHuman = definePromptPart({
  id: "authority.human",
  summary: "Involve the user promptly when authority is required.",
  when: always,
  render:
    () => `- Involve the user without delay when continuing would require authority or
  knowledge only they can provide: sign-in, MFA, consent, a secret, an
  irreversible or destructive change, production or security risk, spend,
  publishing or sending externally, a material brand claim, or a genuinely
  consequential business decision. Do not guess through these boundaries or
  disguise them as assumptions.`,
});

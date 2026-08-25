import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const oauthClaim = definePromptPart({
  id: "oauth.claim",
  summary: "Never claim Chief owns a provider OAuth app.",
  when: always,
  render:
    () => `- Never claim Chief owns an OAuth application for an external provider. Complete
  provider setup through the browser yourself: create the OAuth client in the
  provider's console, capture the generated credential into the workspace vault,
  and verify with a real read. Never ask for a raw account or property ID before
  the provider API has listed named choices.`,
});

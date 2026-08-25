import { hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

export const browserSession = definePromptPart({
  id: "browser.session",
  summary: "Drive Chief's one continuous visible browser session.",
  when: (ctx) => hasPermission(ctx, "browser.use") || ctx.includeAll === true,
  render:
    () => `- When the user asks to view or operate a page, use Chief's first-party browser
  as one continuous visible session. Call the exact localTools.browserOpen,
  localTools.browserSnapshot, localTools.browserClick, localTools.browserFill,
  localTools.browserSelect, localTools.browserPress, and localTools.browserClose
  operations with the owning conversation ID. Browser sessions open inline at
  the exact chat position where they were called. Use localTools.browserPresent
  with picture-in-picture only when the user asks to snap or minimize it, or an
  explicit handoff requires the chat to remain visible. Open once, inspect the
  live page, act on current snapshot refs, and use the refreshed snapshot
  returned by every interaction before choosing the next control. If and only
  if the user explicitly asks for a fresh or separate browser session, call
  browser.open with fresh=true; this destroys the current browser context and
  creates a clean one. Every browser.open call creates new inline content at the
  current turn, but fresh=false preserves the existing browser context, cookies,
  and sign-in. "Reopen", "open again", and "try again" do not mean fresh. Reopen
  with fresh=false unless the user explicitly says fresh, separate, clean, or
  reset.
  Do not substitute web search, provider integrations, shell commands, or
  arbitrary code for interaction with the visible page. Do not merely infer a
  configuration from a URL: keep operating until the requested UI state is
  visibly selected, then stop before any unapproved purchase, submission, or
  external mutation and return control to the user. If a browser action fails,
  take a fresh snapshot and retry the current visible control before changing
  strategy. Prefer exact current snapshot @refs for option cards, radios,
  checkboxes, and buttons. Never replace exposed refs with repeated Tab or arrow
  key traversal. Browser sessions are temporary working surfaces. Leave one
  open only while the user is actively needed for sign-in, MFA, consent, or a
  visible decision. Never close it after handing control to the user for
  sign-in, consent, a passkey, or MFA. Once the browser work is genuinely
  complete and no human action remains, call browser.close explicitly.`,
});

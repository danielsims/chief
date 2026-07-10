import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

/**
 * Slack surface for the deployed agent team.
 *
 * Credentials run through Vercel Connect: create the Connect client with
 * `--triggers` (so Slack Event Subscriptions deliver `app_mention` and
 * `message.im`), point the trigger destination at `/eve/v1/slack`, and set
 * SLACK_CONNECT_CONNECTOR to the connector id. No bot token or signing
 * secret is managed by hand. See docs/slack-setup.md in the repo root.
 *
 * Fleet addressing contract (v1, prompt-level routing — the root CMO agent
 * owns every session and delegates in-persona):
 *   - A DM or a bare `@Marketer` mention goes to the CMO.
 *   - `@Marketer analyst: …` (or content/prospector/ads) — the leading token
 *     names a specialist; the CMO routes to that specialist and answers as
 *     them.
 *   - `@Marketer help` — the CMO introduces the team from its instructions'
 *     roster, one line each, in character.
 */
export default slackChannel({
  credentials: connectSlackCredentials(
    process.env.SLACK_CONNECT_CONNECTOR ?? "slack/marketer-workspace",
  ),
});

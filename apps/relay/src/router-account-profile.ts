import {
  claimUsername,
  findUsernameOwner,
  getChiefProfile,
} from "@chief/auth/d1-users";
import {
  usernameIssue,
  usernameSetCommandSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";

export async function routeAccountProfile(env: Env, request: Request) {
  const url = new URL(request.url);
  if (!["/v1/me/profile", "/v1/me/username"].includes(url.pathname))
    return null;
  const auth = await authenticateRelayRequest(request, env);
  requireAccountBinding(env, auth.bound);
  if (auth.identity.kind !== "user")
    throw new HttpError(
      403,
      "user_required",
      "A signed-in account is required.",
    );
  const userId = auth.identity.userId;
  const profile = await getChiefProfile(env.AUTH_DB, userId);
  if (!profile)
    throw new HttpError(
      404,
      "account_not_found",
      "Your account is no longer available.",
    );
  if (request.method === "GET" && url.pathname === "/v1/me/profile")
    return json(profile);
  if (request.method === "GET" && url.pathname === "/v1/me/username") {
    const issue = usernameIssue(url.searchParams.get("candidate") ?? "");
    if (!issue.ok) return json({ available: false, ...issue, ok: undefined });
    const owner = await findUsernameOwner(env.AUTH_DB, issue.username);
    return json(
      owner && owner !== userId
        ? {
            available: false,
            username: issue.username,
            reason: "taken",
            message: "That username is already taken.",
          }
        : { available: true, username: issue.username },
    );
  }
  if (request.method === "POST" && url.pathname === "/v1/me/username") {
    const input = usernameSetCommandSchema.parse(await parseJson(auth.request));
    const issue = usernameIssue(input.username);
    if (!issue.ok) throw new HttpError(400, "username_invalid", issue.message);
    const result = await claimUsername(env.AUTH_DB, userId, issue.username);
    if (result !== "saved")
      throw new HttpError(
        result === "taken" ? 409 : 404,
        "username_" + result,
        result === "taken"
          ? "That username is already taken."
          : "Your account is no longer available.",
      );
    return json({ username: issue.username });
  }
  throw new HttpError(405, "method_not_allowed", "Method not allowed.");
}

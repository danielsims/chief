import assert from "node:assert/strict";
import test from "node:test";

import {
  OAuthTokenError,
  shouldInvalidateOAuthSession,
} from "../src/lib/auth/oauth-token-error";

void test("invalidates a durable login only after an explicit OAuth rejection", () => {
  assert.equal(
    shouldInvalidateOAuthSession(new OAuthTokenError("expired", 401)),
    true,
  );
  assert.equal(
    shouldInvalidateOAuthSession(new OAuthTokenError("invalid grant", 400)),
    true,
  );
  assert.equal(
    shouldInvalidateOAuthSession(new OAuthTokenError("relay failed", 503)),
    false,
  );
  assert.equal(
    shouldInvalidateOAuthSession(new DOMException("timed out", "TimeoutError")),
    false,
  );
});

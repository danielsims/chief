import assert from "node:assert/strict";
import test from "node:test";

import {
  isExplicitWorkspaceEntry,
  shouldResumeWorkspaceCreate,
} from "../src/lib/workspace-entry.js";

void test("treats add and both invitation routes as intentional workspace entry", () => {
  assert.equal(isExplicitWorkspaceEntry(""), false);
  assert.equal(isExplicitWorkspaceEntry("?intent=add"), true);
  assert.equal(
    isExplicitWorkspaceEntry("?invite=chief-desktop%3A%2F%2Fjoin"),
    true,
  );
  assert.equal(
    isExplicitWorkspaceEntry(
      "?organizationInvite=chief-desktop%3A%2F%2Forganization-invite",
    ),
    true,
  );
  assert.equal(isExplicitWorkspaceEntry("?intent=onboarding"), false);
});

void test("resumes workspace creation only on the relay that was selected", () => {
  assert.equal(
    shouldResumeWorkspaceCreate(
      "https://relay.example.com/path",
      "https://relay.example.com",
    ),
    true,
  );
  assert.equal(
    shouldResumeWorkspaceCreate(
      "https://relay.example.com",
      "https://other.example.com",
    ),
    false,
  );
  assert.equal(
    shouldResumeWorkspaceCreate("not a URL", "https://relay.example.com"),
    false,
  );
  assert.equal(
    shouldResumeWorkspaceCreate(null, "https://relay.example.com"),
    false,
  );
});

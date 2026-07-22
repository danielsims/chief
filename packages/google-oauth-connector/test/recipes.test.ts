import assert from "node:assert/strict";
import test from "node:test";

import {
  googleAccountChooserUrl,
  googleAnalyticsRecipe,
  googleApiLibraryUrl,
} from "../src/index.js";

void test("starts with an explicit Google account chooser", () => {
  const service = googleAnalyticsRecipe.services[0];
  assert.ok(service);
  const target = googleApiLibraryUrl(service);
  const chooser = new URL(googleAccountChooserUrl(target));

  assert.equal(chooser.hostname, "accounts.google.com");
  assert.equal(chooser.pathname, "/AccountChooser");
  assert.equal(chooser.searchParams.get("service"), "cloudconsole");
  assert.equal(chooser.searchParams.get("continue"), target);
});

void test("Analytics enables both required APIs", () => {
  assert.deepEqual(
    googleAnalyticsRecipe.services.map((service) => service.service),
    ["analyticsdata.googleapis.com", "analyticsadmin.googleapis.com"],
  );
});

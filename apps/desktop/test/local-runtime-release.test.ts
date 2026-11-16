import assert from "node:assert/strict";
import test from "node:test";

import { publishedRuntimeRelease } from "../scripts/local-runtime-release.mjs";

const target = "aarch64-apple-darwin";
const asset = {
  name: `chief-plugin-runtime-0.1.6-${target}.tar.gz`,
  state: "uploaded",
  digest: `sha256:${"a".repeat(64)}`,
  browser_download_url: `https://github.com/danielsims/chief/releases/download/v0.1.6/chief-plugin-runtime-0.1.6-${target}.tar.gz`,
};
const metadata = { tag_name: "v0.1.6", draft: false, assets: [asset] };

void test("local builds pin the actual published runtime digest", () => {
  const release = publishedRuntimeRelease(metadata, "0.1.6", target);
  assert.equal(release.sha256, "a".repeat(64));
  assert.equal(release.url, asset.browser_download_url);
});
void test("local builds reject unpublished, redirected or unpinned runtimes", () => {
  for (const release of [
    { ...metadata, tag_name: "v0.1.5" },
    { ...metadata, draft: true },
    { ...metadata, assets: [] },
    { ...metadata, assets: [{ ...asset, digest: "" }] },
    {
      ...metadata,
      assets: [
        {
          ...asset,
          browser_download_url: "https://example.com/runtime.tar.gz",
        },
      ],
    },
    { ...metadata, assets: [{ ...asset, state: "new" }] },
  ]) {
    assert.throws(() => publishedRuntimeRelease(release, "0.1.6", target));
  }
});

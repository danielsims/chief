import assert from "node:assert/strict";
import test from "node:test";

import { captureGoogleDesktopOAuthClient } from "../src/index.js";

void test("captures a Google client through a host-owned browser boundary", async () => {
  let url =
    "https://console.cloud.google.com/auth/clients/create?project=example";
  let summaryOpen = false;
  let evaluations = 0;
  const client = await captureGoogleDesktopOAuthClient({
    getUrl: () => Promise.resolve(url),
    evaluate: <T>() => {
      evaluations += 1;
      if (evaluations === 1) {
        return Promise.resolve("client.apps.googleusercontent.com" as T);
      }
      return Promise.resolve((summaryOpen ? "secret" : null) as T);
    },
    open: (nextUrl) => {
      url = nextUrl;
      return Promise.resolve();
    },
    waitForFunction: () => Promise.resolve(),
    click: () => {
      summaryOpen = true;
      return Promise.resolve();
    },
  });

  assert.equal(client.clientId, "client.apps.googleusercontent.com");
  assert.equal(client.clientSecret, "secret");
  assert.equal(client.projectId, "example");
  assert.match(url, /\/auth\/clients\/client\.apps\.googleusercontent\.com/);
});

void test("waits for Google's accessible summary label within the host timeout", async () => {
  const waits: { expression: string; timeout?: number }[] = [];
  let summaryOpen = false;
  await captureGoogleDesktopOAuthClient({
    getUrl: () =>
      Promise.resolve(
        "https://console.cloud.google.com/auth/clients/client.apps.googleusercontent.com?project=example",
      ),
    evaluate: <T>() => Promise.resolve((summaryOpen ? "secret" : null) as T),
    open: () => Promise.resolve(),
    waitForFunction: (expression, timeout) => {
      waits.push({ expression, timeout });
      return Promise.resolve();
    },
    click: () => {
      summaryOpen = true;
      return Promise.resolve();
    },
  });

  assert.match(waits[0]?.expression ?? "", /aria-label/);
  assert.equal(waits[0]?.timeout, 15_000);
});

void test("creates a fresh host-owned secret when Google masks the original", async () => {
  const clicks: string[][] = [];
  let summaryOpen = false;
  let freshSecretCreated = false;
  const client = await captureGoogleDesktopOAuthClient({
    getUrl: () =>
      Promise.resolve(
        "https://console.cloud.google.com/auth/clients/client.apps.googleusercontent.com?project=example",
      ),
    evaluate: <T>() =>
      Promise.resolve(
        (freshSecretCreated ? "fresh-secret" : summaryOpen ? null : null) as T,
      ),
    open: () => Promise.resolve(),
    waitForFunction: () => Promise.resolve(),
    click: (labels) => {
      clicks.push(labels);
      if (labels.includes("Information and summary")) summaryOpen = true;
      if (labels.includes("Add client secret")) freshSecretCreated = true;
      return Promise.resolve();
    },
  });

  assert.equal(client.clientId, "client.apps.googleusercontent.com");
  assert.equal(client.clientSecret, "fresh-secret");
  assert.deepEqual(clicks, [
    ["Information and summary"],
    ["Add client secret", "Add Client secret", "Add secret"],
  ]);
});

void test("matches Google's current lowercase client-secret label", async () => {
  const waits: string[] = [];
  let secretCreated = false;
  await captureGoogleDesktopOAuthClient({
    getUrl: () =>
      Promise.resolve(
        "https://console.cloud.google.com/auth/clients/client.apps.googleusercontent.com?project=example",
      ),
    evaluate: <T>() =>
      Promise.resolve((secretCreated ? "fresh-secret" : null) as T),
    open: () => Promise.resolve(),
    waitForFunction: (expression) => {
      waits.push(expression);
      return Promise.resolve();
    },
    click: (labels) => {
      if (labels.includes("Add client secret")) secretCreated = true;
      return Promise.resolve();
    },
  });

  assert.match(waits[1] ?? "", /add client secret/);
  assert.match(waits[1] ?? "", /toLowerCase/);
});

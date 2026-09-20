import assert from "node:assert/strict";
import test from "node:test";

import { isJsonObject, parseJsonObject } from "@chief/relay-contracts";

import {
  hostedAgentToolDefinitions,
  localAgentToolDefinitions,
} from "../src/tools/model.js";
import { fillBrowserDefinition } from "../src/tools/toolkits/browser/fill-browser.js";
import { selectBrowserDefinition } from "../src/tools/toolkits/browser/select-browser.js";

void test("hosted inference tools expose OpenAI object parameter schemas", () => {
  const tools = localAgentToolDefinitions([
    ...hostedAgentToolDefinitions.base,
    ...hostedAgentToolDefinitions.browser,
  ]);
  assert.ok(tools.length > 0);
  for (const tool of tools) {
    const parameters = parseJsonObject(tool.parameters);
    assert.ok(parameters, `${tool.name} parameters must be a JSON object`);
    assert.equal(
      parameters.type,
      "object",
      `${tool.name} must declare type: object`,
    );
    assert.equal(
      parameters.allOf,
      undefined,
      `${tool.name} must not send allOf function parameters`,
    );
    assert.ok(
      isJsonObject(parameters.properties),
      `${tool.name} must declare properties`,
    );
  }
});

void test("browser fill and select merge intersection fields into one object", () => {
  const [fill, select] = localAgentToolDefinitions([
    fillBrowserDefinition,
    selectBrowserDefinition,
  ]);
  assert.ok(fill);
  assert.ok(select);
  const fillParameters = parseJsonObject(fill.parameters);
  const selectParameters = parseJsonObject(select.parameters);
  const fillProperties = parseJsonObject(fillParameters?.properties);
  const selectProperties = parseJsonObject(selectParameters?.properties);
  assert.ok(fillProperties);
  assert.ok(selectProperties);
  assert.ok(fillProperties.value);
  assert.ok(fillProperties.ref);
  assert.deepEqual(fillParameters?.required, ["value"]);
  assert.ok(selectProperties.values);
  assert.ok(selectProperties.labels);
  assert.deepEqual(selectParameters?.required, ["values"]);
});

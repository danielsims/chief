import assert from "node:assert/strict";
import test from "node:test";

import { onboardingCompletionPresentation } from "../src/lib/onboarding-completion.js";

void test("a disconnected runtime cannot trap completed onboarding", () => {
  assert.deepEqual(
    onboardingCompletionPresentation({ runtimeReady: false, saving: false }),
    {
      description:
        "Your workspace is saved. Chief will finish preparing it in the background when the runtime reconnects.",
      buttonLabel: "Enter workspace",
      buttonDisabled: false,
    },
  );
});

void test("the completion action disables only while onboarding is saving", () => {
  const presentation = onboardingCompletionPresentation({
    runtimeReady: true,
    saving: true,
  });
  assert.equal(presentation.buttonLabel, "Entering...");
  assert.equal(presentation.buttonDisabled, true);
});

export function onboardingCompletionPresentation({
  runtimeReady,
  saving,
}: {
  runtimeReady: boolean;
  saving: boolean;
}) {
  return {
    description: runtimeReady
      ? "Your workspace is ready. Chief will meet you in mission control and bring Setup in when needed."
      : "Your workspace is saved. Chief will finish preparing it in the background when the runtime reconnects.",
    buttonLabel: saving ? "Entering..." : "Enter workspace",
    buttonDisabled: saving,
  };
}

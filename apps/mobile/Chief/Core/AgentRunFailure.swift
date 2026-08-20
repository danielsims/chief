import Foundation

/// A provider-neutral, user-safe failure emitted by one agent run. Runtime
/// implementations may originate errors from inference, relay access, tools,
/// or the cell itself; the conversation surface only needs one durable shape.
struct AgentRunFailure: Equatable, Sendable {
  let code: String
  let title: String
  let message: String
  let retryable: Bool

  init(_ error: Error) {
    switch error as? WorkspaceSetupError {
    case .providerUsageLimit:
      code = "inference_limit"
      title = "Inference unavailable"
      message =
        "This agent's inference provider reported that its balance or usage limit was reached. Choose another model or reconnect the agent's provider, then retry."
      retryable = false
    case .missingCredential:
      code = "inference_not_connected"
      title = "Inference isn't connected"
      message = "Connect an inference provider for this agent, then retry the run."
      retryable = false
    case .missingRequiredToolCalls:
      code = "required_actions_incomplete"
      title = "Required actions weren't completed"
      message = "The agent stopped before completing the actions required by this run."
      retryable = true
    case .missingJob:
      code = "job_unavailable"
      title = "Run unavailable"
      message = "The agent's durable job wasn't available when the cell attempted to resume it."
      retryable = true
    case .unsupportedInference:
      code = "inference_unsupported"
      title = "Model unavailable"
      message = "The selected model can't run this agent yet. Choose another model and retry."
      retryable = false
    case .inferenceFailed:
      code = "inference_failed"
      title = "Inference failed"
      message = "The agent's inference request failed before it produced a response."
      retryable = true
    case nil:
      code = "run_failed"
      title = "Run failed"
      message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
      retryable = true
    }
  }

  func component(id: String = "run-error") -> MessageComponent {
    MessageComponent(
      id: id,
      kind: "error",
      payload: [
        "code": code,
        "title": title,
        "message": message,
        "retryable": retryable ? "true" : "false",
      ]
    )
  }
}


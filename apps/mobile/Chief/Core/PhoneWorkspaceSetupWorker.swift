import Foundation

actor PhoneWorkspaceSetupWorker {
  private let relay: any RelayServing
  private let credentials: InferenceCredentialStore
  private let onActivity: AgentActivityCallback

  init(
    relay: any RelayServing,
    credentials: InferenceCredentialStore,
    onActivity: @escaping AgentActivityCallback
  ) {
    self.relay = relay
    self.credentials = credentials
    self.onActivity = onActivity
  }

  func run(draft: OnboardingDraft, workspaceID: String) async throws {
    guard draft.runtime == .phone else { return }
    let supported: Bool
    switch draft.inferenceProvider {
    case .openCodeGo:
      supported = true
    #if DEBUG
      case .codexBridge:
        supported = true
    #endif
    default:
      supported = false
    }
    guard supported else {
      throw WorkspaceSetupError.unsupportedInference
    }
    guard let provider = draft.inferenceProvider else {
      throw WorkspaceSetupError.unsupportedInference
    }
    print("[Chief] phone worker inference connected: \(credentials.contains(provider))")
    guard let lease = try await claim(workspaceID: workspaceID) else {
      throw WorkspaceSetupError.missingJob
    }
    print("[Chief] phone worker claimed \(lease.job.kind)")
    guard lease.job.agentId == "chief", lease.job.kind == "workspace.onboarding" else {
      throw WorkspaceSetupError.missingJob
    }
    do {
      // Mission Control is already on screen. Keep the opening arrival quick,
      // then let Chief perform the complete kickoff as one durable cell turn.
      try await Task.sleep(for: .milliseconds(100))
      let host = ChiefOpenCodeAgentHost(
        relay: relay,
        credentials: credentials,
        onActivity: onActivity
      )
      try await ChiefCellRuntime.shared.start(host: host)
      let scope = try ChiefCellRuntime.scope(workspaceID: workspaceID, agentID: "chief")
      let expectedDelegates = Set(
        (lease.job.payload.selectedApps ?? Array(draft.selectedApps)).isEmpty
          ? ["brand", "prospector", "engineer"]
          : ["brand", "prospector", "engineer", "setup"]
      )
      let kickoff = try await completeKickoffTurn(
        scope: scope,
        instruction: kickoffInstruction(draft: draft, job: lease.job),
        jobKind: lease.job.kind,
        expectedDelegates: expectedDelegates
      )
      try await relay.completeAgentJob(
        workspaceID: workspaceID,
        agentID: "chief",
        leaseToken: lease.leaseToken,
        completion: AgentJobCompletion(
          openingMessage: Self.openingMessage,
          publishedMessage: AgentPublishedMessage(
            conversationId: "mission-control",
            body: Self.openingMessage,
            components: []
          )
        )
      )
      print("[Chief] phone worker completed \(lease.job.kind)")
    } catch {
      let failure = AgentRunFailure(error)
      await onActivity(
        workspaceID,
        "mission-control",
        "chief",
        failure.component()
      )
      try? await relay.failAgentJob(
        workspaceID: workspaceID,
        agentID: "chief",
        leaseToken: lease.leaseToken,
        error: failure.message,
        retryAt: AgentRetryPolicy.retryDate(
          attempt: lease.job.attempt,
          error: error
        )
      )
      throw error
    }
  }

  /// Continue the same durable cell session when a model stops after only part
  /// of the kickoff. The relay idempotency keys make this safe, and cumulative
  /// cell evidence proves that the agent itself completed every action.
  private func completeKickoffTurn(
    scope: String,
    instruction: String,
    jobKind: String,
    expectedDelegates: Set<String>
  ) async throws -> TurnExtractor.Turn {
    var nextInstruction = instruction
    for attempt in 0..<3 {
      let result = try await ChiefCellRuntime.shared.runTurn(
        scope: scope,
        conversationID: "mission-control",
        userText: nextInstruction
      )
      let turn = try TurnExtractor.extract(from: result)
      do {
        try KickoffToolEvidence.validate(
          components: turn.evidenceComponents,
          jobKind: jobKind,
          expectedDelegates: expectedDelegates
        )
        return turn
      } catch WorkspaceSetupError.missingRequiredToolCalls where attempt < 2 {
        nextInstruction = """
          Continue the same kickoff. Your preceding turn stopped before every required relay action was complete. Inspect the tool results and current relay state, then make only the remaining calls from the original instruction now. Do not repeat completed work; every message idempotency key and membership operation is safe to verify. Return only after the complete original outcome exists.
          """
      }
    }
    throw WorkspaceSetupError.missingRequiredToolCalls
  }

  private func claim(workspaceID: String) async throws -> AgentJobLease? {
    for attempt in 0..<3 {
      if let lease = try await relay.claimAgentJob(
        workspaceID: workspaceID,
        agentID: "chief"
      ) {
        return lease
      }
      if attempt < 2 { try await Task.sleep(for: .milliseconds(250)) }
    }
    return nil
  }

  private static let openingMessage =
    "Hey, welcome to Chief 👋 I'm getting the team together now. We'll have a look around, get to know your brand and market, and start figuring out where the good opportunities are hiding. You can hang out here and watch us work. I'll give you a shout if I need anything."

  private func kickoffInstruction(draft: OnboardingDraft, job: AgentJobLease.Job) -> String {
    if let instruction = job.payload.instruction?.trimmingCharacters(
      in: .whitespacesAndNewlines
    ), !instruction.isEmpty {
      return instruction
    }
    let name = job.payload.name ?? draft.companyName
    let websiteValue = job.payload.website ?? draft.website
    let website = websiteValue.isEmpty ? "not supplied" : websiteValue
    let selectedApps = Set(job.payload.selectedApps ?? Array(draft.selectedApps))
    let apps =
      selectedApps.isEmpty
      ? "none selected"
      : selectedApps.sorted().joined(separator: ", ")
    let delegates =
      selectedApps.isEmpty
      ? #"["brand", "prospector", "engineer"]"#
      : #"["brand", "prospector", "engineer", "setup"]"#
    let setupKickoff = selectedApps.isEmpty
      ? ""
      : """
         - idempotencyKey onboarding-setup-thread: "Hey @Setup, privately help me connect the selected apps: \(apps). Start with what can be verified safely and only ask me to step in for sign-in, consent, or an unavoidable account choice."
        """
    let callCount = selectedApps.isEmpty ? "five" : "six"
    return """
      CHIEF_DELEGATION_REQUIRED

      Open Mission Control for \(name). Website: \(website). Selected apps: \(apps).
      Use relay tools to carry out the complete kickoff once. This is real work, not a description of what you might do. Every relay_message_post call below must include its stated idempotencyKey so retrying this durable turn cannot duplicate a visible message.

      1. First call relay_message_post in mission-control with idempotencyKey onboarding-chief-opening and this exact opening:
      \(Self.openingMessage)
      2. Invite the delegated agent IDs to mission-control with exactly one relay_channels_members_add call using kind agent and principalIds \(delegates). Never split this into separate membership calls.
      3. Post each top-level kickoff message below in mission-control using relay_message_post:
         - idempotencyKey onboarding-marketer-thread: "Hey @Marketer, use [chief-skill:build-brand-profile] to create a useful working profile from our first-party evidence. Ask one focused question here only if a missing preference materially changes it."
         - idempotencyKey onboarding-prospector-thread: "Hey @Prospector, use [chief-skill:find-buying-signals] to find our first real buying signals from the best available evidence. Ask one focused question here only if it materially changes qualification."
         - idempotencyKey onboarding-engineer-thread: "Hey @Engineer, get oriented and prepare the Engineering workspace. Don't change code or deploy anything yet."
      \(setupKickoff)

      Make every call now. Do not replace any tool call with prose. After all \(callCount) calls succeed, return one short private completion sentence; it won't be posted to the channel.
      """
  }
}

enum WorkspaceSetupError: LocalizedError, Equatable {
  case inferenceFailed
  case missingCredential
  case missingJob
  case missingRequiredToolCalls
  case providerUsageLimit
  case unsupportedInference

  var errorDescription: String? {
    switch self {
    case .inferenceFailed: "Chief could not finish the first setup response. Try again."
    case .missingCredential: "Reconnect OpenCode Go to start Chief on this iPhone."
    case .missingJob: "Chief's setup job was not available. Try again."
    case .missingRequiredToolCalls:
      "The agent did not complete its required relay actions. Chief will retry."
    case .providerUsageLimit:
      "This agent's inference provider reported that its balance or usage limit was reached. Choose another model or reconnect the agent's provider, then retry."
    case .unsupportedInference: "This on-device model cannot run Chief yet."
    }
  }
}

struct OpenCodeRequest: Encodable {
  struct Message: Encodable {
    let role: String
    let content: String?
    let toolCalls: [ToolCall]?
    let toolCallID: String?

    init(
      role: String,
      content: String?,
      toolCalls: [ToolCall]? = nil,
      toolCallID: String? = nil
    ) {
      self.role = role
      self.content = content
      self.toolCalls = toolCalls
      self.toolCallID = toolCallID
    }

    enum CodingKeys: String, CodingKey {
      case role
      case content
      case toolCalls = "tool_calls"
      case toolCallID = "tool_call_id"
    }
  }

  struct ToolCall: Encodable {
    struct Function: Encodable {
      let name: String
      let arguments: String
    }
    let id: String
    let type: String
    let function: Function
  }

  struct ToolDefinition: Encodable {
    struct Function: Encodable {
      let name: String
      let description: String
      let parameters: [String: AnyEncodable]
    }
    let type: String
    let function: Function
  }

  let model: String
  let messages: [Message]
  let maxTokens: Int
  let tools: [ToolDefinition]?
  let toolChoice: String?
  let stream: Bool

  init(
    model: String,
    messages: [Message],
    maxTokens: Int,
    tools: [ToolDefinition]? = nil,
    toolChoice: String? = nil,
    stream: Bool = false
  ) {
    self.model = model
    self.messages = messages
    self.maxTokens = maxTokens
    self.tools = tools
    self.toolChoice = toolChoice
    self.stream = stream
  }

  enum CodingKeys: String, CodingKey {
    case model, messages, tools, stream
    case maxTokens = "max_tokens"
    case toolChoice = "tool_choice"
  }
}

struct OpenCodeResponse: Decodable {
  struct Choice: Decodable {
    struct Message: Decodable {
      struct ToolCall: Decodable, Sendable {
        struct Function: Decodable, Sendable {
          let name: String
          let arguments: String
        }
        let id: String
        let function: Function
      }
      let content: String?
      let toolCalls: [ToolCall]?

      enum CodingKeys: String, CodingKey {
        case content
        case toolCalls = "tool_calls"
      }
    }
    let message: Message
  }
  let choices: [Choice]
}

/// Bridges arbitrary JSON values into `Encodable` for tool schemas.
struct AnyEncodable: Encodable {
  let value: Any

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch value {
    case let int as Int: try container.encode(int)
    case let double as Double: try container.encode(double)
    case let bool as Bool: try container.encode(bool)
    case let string as String: try container.encode(string)
    case let array as [Any]: try container.encode(array.map(AnyEncodable.init(value:)))
    case let dict as [String: Any]: try container.encode(dict.mapValues { AnyEncodable(value: $0) })
    default: try container.encodeNil()
    }
  }
}

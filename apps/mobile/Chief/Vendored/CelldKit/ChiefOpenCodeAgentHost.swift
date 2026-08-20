import Foundation
import os

typealias AgentActivityCallback = @Sendable (
  _ workspaceID: String,
  _ conversationID: String,
  _ agentID: String,
  _ component: MessageComponent
) async -> Void

/// Adapter that powers one agent turn in a cell: inference via OpenCode Go and
/// a small phone-local toolset that posts to the workspace relay (the mobile
/// analog of the durable agent's channel tools).
protocol ChiefAgentHosting: Sendable {
  /// Respond to a full turn. `messagesJSON` is the durable transcript array.
  /// Returns a JSON envelope `{"reply": "...", "tools": [...]}` that the worker
  /// persists, mirroring `env.AI.respond`.
  func respond(scope: String, messagesJSON: String) async -> String
}

private struct ReasoningSegment: Sendable {
  let text: String
  let durationMilliseconds: Double
}

/// Owns one model-request reasoning segment. A new instance is created after
/// every tool boundary, so the activity panel retains the provider's actual
/// reasoning → tool → reasoning sequence instead of hoisting thoughts.
private actor ReasoningActivityEmitter {
  let workspaceID: String
  let conversationID: String
  let agentID: String
  let callback: AgentActivityCallback
  let checkpoint: AgentTurnCheckpoint

  private let componentID = "reasoning-\(UUID().uuidString)"
  private var text = ""
  private var startedAt: ContinuousClock.Instant?

  init(
    workspaceID: String,
    conversationID: String,
    agentID: String,
    checkpoint: AgentTurnCheckpoint,
    callback: @escaping AgentActivityCallback
  ) {
    self.workspaceID = workspaceID
    self.conversationID = conversationID
    self.agentID = agentID
    self.checkpoint = checkpoint
    self.callback = callback
  }

  func append(_ delta: String) async {
    guard !delta.isEmpty else { return }
    if startedAt == nil {
      startedAt = .now
      print("[Chief] agent \(agentID) reasoning stream started")
    }
    text += delta
    await checkpoint.appendReasoning(id: componentID, delta: delta)
    await publish(status: "running")
  }

  func finish() async -> ReasoningSegment? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let startedAt else { return nil }
    await checkpoint.finishReasoning(id: componentID)
    await publish(status: "completed")
    print("[Chief] agent \(agentID) reasoning stream completed")
    let duration = startedAt.duration(to: .now)
    return ReasoningSegment(
      text: trimmed,
      durationMilliseconds: Double(duration.components.seconds) * 1_000
        + Double(duration.components.attoseconds) / 1e15
    )
  }

  private func publish(status: String) async {
    await callback(
      workspaceID,
      conversationID,
      agentID,
      MessageComponent(
        id: componentID,
        kind: "thinking",
        payload: ["text": text, "status": status]
      )
    )
  }
}

/// Concrete host that runs inference through the OpenCode Go API and executes
/// the package-level relay tools natively (running them in an OpenAI-style
/// tool loop). Tool invocations are returned in the envelope's `tools` so the
/// worker persists them into the durable transcript, grounding the reply in
/// real workspace state.
actor ChiefOpenCodeAgentHost: ChiefAgentHosting {
  private let relay: any RelayServing
  private let credentials: InferenceCredentialStore
  private let onActivity: AgentActivityCallback
  private let logger = Logger(subsystem: "sh.heychief.mobile", category: "AgentHost")

  private static let maxToolRounds = 24

  init(
    relay: any RelayServing,
    credentials: InferenceCredentialStore,
    onActivity: @escaping AgentActivityCallback = { _, _, _, _ in }
  ) {
    self.relay = relay
    self.credentials = credentials
    self.onActivity = onActivity
  }

  func respond(scope: String, messagesJSON: String) async -> String {
    let conversationID = Self.conversationID(from: messagesJSON)
    let checkpoint = AgentTurnCheckpoint(
      scope: scope,
      conversationID: conversationID,
      userAt: Self.latestUserTimestamp(from: messagesJSON)
    )
    do {
      try await checkpoint.begin()
      let (reply, tools, activity) = try await runTurn(
        scope: scope,
        messagesJSON: messagesJSON,
        checkpoint: checkpoint
      )
      await checkpoint.finish(text: reply)
      return Self.envelope(reply: reply, tools: tools, activity: activity)
    } catch {
      logger.error("turn failed: \(error.localizedDescription)")
      let (workspaceID, agentID) = Self.scopeParts(scope)
      let failure = AgentRunFailure(error)
      await checkpoint.fail(failure)
      await onActivity(
        workspaceID,
        conversationID,
        agentID,
        failure.component()
      )
      // Report the failure to the worker as an error envelope (no reply), so it
      // keeps the turn pending and the UI can offer a retry — never fabricate.
      return Self.errorEnvelope(error)
    }
  }

  /// Build the `env.AI.respond` envelope with correct JSON escaping.
  private static func envelope(
    reply: String,
    tools: [[String: Any]],
    activity: [[String: Any]]
  ) -> String {
    let payload: [String: Any] = [
      "reply": reply,
      "tools": tools,
      "activity": activity,
    ]
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    return String(data: data, encoding: .utf8) ?? #"{"reply":"","tools":[]}"#
  }

  private static func errorEnvelope(_ error: Error) -> String {
    let failure = AgentRunFailure(error)
    let payload: [String: Any] = [
      "reply": "",
      "tools": [],
      "activity": [],
      "error": failure.message,
      "errorCode": failure.code,
    ]
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    return String(data: data, encoding: .utf8) ?? #"{"error":"inference failed"}"#
  }

  /// Runs inference + tool calls in a loop until the model produces a final
  /// text reply. Returns the reply and the executed tool records.
  private func runTurn(
    scope: String,
    messagesJSON: String,
    checkpoint: AgentTurnCheckpoint
  ) async throws -> (String, [[String: Any]], [[String: Any]]) {
    let (workspaceID, agentID) = Self.scopeParts(scope)
    let conversationID = Self.conversationID(from: messagesJSON)
    let agent =
      WorkspaceAgentCatalog.agent(forID: agentID)
      ?? MentionAgent(
        id: agentID,
        name: agentID.capitalized,
        role: "Agent"
      )
    let authoredPackage = try AgentPackageBundle.load(agentID: agentID)
    let identity = try AgentIdentityStore(
      workspaceID: workspaceID,
      agentID: agentID
    ).ensure()
    let config =
      AgentConfigStore().load(
        workspaceID: workspaceID,
        agentID: agentID
      ) ?? AgentConfig.defaults(for: agentID)
    guard config.enabled else {
      throw ToolError.permissionDenied("runtime")
    }
    let existingBrandProfile = try? await relay.loadBrandProfile(
      workspaceID: workspaceID,
      signingIdentity: identity
    )
    let loadedWorkspace = try? await relay.loadWorkspace()
    let workspaceContext = AgentWorkspaceContext.resolve(
      workspace: loadedWorkspace,
      expectedWorkspaceID: workspaceID,
      messagesJSON: messagesJSON
    )

    var convoy = [OpenCodeRequest.Message]()
    let attachedSkill = AgentSkillBundle.instructions(
      referencedBy: messagesJSON,
      agentID: agentID
    )
    let packageInstructions = authoredPackage.instructions
    convoy.append(
      OpenCodeRequest.Message(
        role: "system",
        content: """
          You are \(agent.name), a \(agent.role) in a workspace owned by a builder. You speak for yourself and act under your own identity; never pretend to be the owner or another agent. Sound like a relaxed, thoughtful teammate in chat. Use natural contractions such as I'm, we'll, you're, and don't whenever they fit. Use sentence case, not stiff announcement language, and never use em dashes. When an instruction requires a relay action, you MUST call the corresponding relay tools before writing the final reply. Instructions and prior assistant claims are never proof that an action happened; only a successful tool result is proof. Do not claim work has happened unless that result exists. Keep replies to 1-3 short sentences unless the work genuinely needs more.

          Canonical agent package instructions:
          \(packageInstructions)

          iOS host binding map: browser_navigate/browser_snapshot/browser_click/browser_type/browser_scroll/browser_back/browser_release are the visible native browser. brand_profile_save fulfills both localTools.brandProfileSave and the editable brand-profile file write. prospects_list and prospects_save fulfill the corresponding local workspace data operations. The relay collaboration tools fulfill the channel and message operations. A package instruction never grants a tool: only the tools advertised for this turn are available.

          Browser research runs in your own isolated on-device WebKit session. Start with browser_navigate, inspect every loaded page with browser_snapshot, use only evidence actually present in snapshots, and finish browser work with browser_release. Stay focused: for onboarding, inspect at most three useful pages and use at most ten browser action calls. Persist the requested workspace result before releasing the browser. Never invent a page, claim, person, company, quotation, or URL.

          Authoritative workspace context from onboarding:
          \(workspaceContext.systemPrompt)

          \(attachedSkill.map { "Attached skill instructions:\n\($0)" } ?? "")

          \(existingBrandProfile.map { "Current shared workspace brand profile:\n\($0.markdown)" } ?? "")
          """
      )
    )
    convoy.append(contentsOf: try loadConvoy(messagesJSON))

    var toolRecords: [[String: Any]] = []
    var activityRecords: [[String: Any]] = []
    var completedToolNames = Self.durableCompletedToolNames(from: messagesJSON)
    let requiresSpecialistKickoffTools = convoy.contains { message in
      message.content?.contains("MUST call relay_channels_create") == true
    }
    let requiresChiefDelegationTools = convoy.contains { message in
      message.content?.contains("CHIEF_DELEGATION_REQUIRED") == true
    }
    var requiredTools: Set<String> =
      requiresSpecialistKickoffTools
      ? KickoffToolEvidence.specialistRequiredTools
      : requiresChiefDelegationTools
        ? KickoffToolEvidence.chiefRequiredTools
        : []
    if convoy.contains(where: {
      $0.content?.contains("[chief-skill:build-brand-profile]") == true
    }) {
      requiredTools.formUnion([
        BrowserNavigateTool.name,
        BrowserSnapshotTool.name,
        BrandProfileSaveTool.name,
        BrowserReleaseTool.name,
      ])
    }
    if convoy.contains(where: {
      $0.content?.contains("[chief-skill:find-buying-signals]") == true
    }) {
      requiredTools.formUnion([
        BrowserNavigateTool.name,
        BrowserSnapshotTool.name,
        ProspectsListTool.name,
        ProspectSaveTool.name,
        BrowserReleaseTool.name,
      ])
    }
    let attachedSkillIDs = Set(
      ["build-brand-profile", "find-buying-signals"].filter {
        messagesJSON.contains("[chief-skill:\($0)]")
      }
    )
    let allowedToolNames = AgentTurnToolPolicy.names(
      requiresChiefDelegation: requiresChiefDelegationTools,
      attachedSkillIDs: attachedSkillIDs
    )
    let definitions = RelayToolRegistry.openAIDefinitions(
      allowing: allowedToolNames
    )
    let context = ToolContext(
      relay: relay,
      identity: identity,
      agentID: agentID,
      workspaceID: workspaceID,
      conversationID: conversationID,
      config: config,
      allowedToolNames: allowedToolNames
    )
    await MainActor.run {
      AgentBrowserSession.beginTurn(for: context.browserScope)
    }
    var timeout = 90

    for _ in 0..<Self.maxToolRounds {
      let needsRequiredTool = !requiredTools.isSubset(of: completedToolNames)
      let reasoning = ReasoningActivityEmitter(
        workspaceID: workspaceID,
        conversationID: conversationID,
        agentID: agentID,
        checkpoint: checkpoint,
        callback: onActivity
      )
      let result = try await complete(
        convoy: convoy,
        tools: definitions,
        model: config.model,
        timeout: timeout,
        onReasoning: { delta in await reasoning.append(delta) }
      )
      if let segment = await reasoning.finish() {
        activityRecords.append([
          "kind": "reasoning",
          "reasoning": [
            "text": segment.text,
            "durationMs": segment.durationMilliseconds,
          ],
        ])
      }
      guard (200..<300).contains(result.response.statusCode) else {
        if result.response.statusCode == 429 {
          let detail = Self.providerErrorSummary(data: result.errorBody)
          print("[Chief] OpenCode usage limit reached\(detail)")
          throw WorkspaceSetupError.providerUsageLimit
        }
        print(
          "[Chief] OpenCode completion failed status=\(result.response.statusCode) agent=\(agentID)"
        )
        throw WorkspaceSetupError.inferenceFailed
      }

      if !result.toolCalls.isEmpty {
        timeout = 120
        for call in result.toolCalls {
          let record = try await executeTool(
            call,
            convoy: &convoy,
            context: context,
            checkpoint: checkpoint,
            completedToolNames: completedToolNames,
            releasePrerequisites: requiredTools.intersection([
              BrandProfileSaveTool.name,
              ProspectSaveTool.name,
            ])
          )
          toolRecords.append(record)
          activityRecords.append(["kind": "tool", "tool": record])
          if record["status"] as? String == "completed",
            let name = record["name"] as? String
          {
            completedToolNames.insert(name)
          }
        }
        continue
      }

      let content = result.content.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !content.isEmpty
      else {
        throw WorkspaceSetupError.inferenceFailed
      }
      if needsRequiredTool {
        convoy.append(OpenCodeRequest.Message(role: "assistant", content: content))
        let missing = requiredTools
          .subtracting(completedToolNames)
          .sorted()
          .joined(separator: ", ")
        convoy.append(
          OpenCodeRequest.Message(
            role: "user",
            content:
              "That reply cannot be accepted yet. Call these required tools successfully before replying: \(missing). Continue with the tools now."
          )
        )
        continue
      }
      return (content, toolRecords, activityRecords)
    }
    throw WorkspaceSetupError.inferenceFailed
  }

  /// Executes one tool call natively, echoes it into the conversation, and
  /// returns its record for the transcript.
  private func executeTool(
    _ call: OpenCodeResponse.Choice.Message.ToolCall,
    convoy: inout [OpenCodeRequest.Message],
    context: ToolContext,
    checkpoint: AgentTurnCheckpoint,
    completedToolNames: Set<String>,
    releasePrerequisites: Set<String>
  ) async throws -> [String: Any] {
    let componentID = "tool-\(call.id)"
    await checkpoint.beginTool(
      id: call.id,
      name: call.function.name,
      input: call.function.arguments
    )
    await onActivity(
      context.workspaceID,
      context.conversationID,
      context.agentID,
      MessageComponent(
        id: componentID,
        kind: "tool",
        payload: [
          "name": call.function.name,
          "status": "running",
          "input": call.function.arguments,
        ]
      )
    )
    convoy.append(
      OpenCodeRequest.Message(
        role: "assistant",
        content: nil,
        toolCalls: [
          .init(
            id: call.id,
            type: "function",
            function: .init(name: call.function.name, arguments: call.function.arguments)
          )
        ]
      )
    )
    let (result, status, errorMessage): (String, String, String?)
    do {
      if call.function.name == BrowserReleaseTool.name,
        !releasePrerequisites.isSubset(of: completedToolNames)
      {
        throw ToolError.invalidArgument(
          "browser_release must follow the required durable save"
        )
      }
      let output = try await RelayToolRegistry.execute(
        name: call.function.name,
        arguments: call.function.arguments,
        context: context
      )
      result = output
      status = "completed"
      errorMessage = nil
    } catch {
      let message = (error as? LocalizedError)?.errorDescription ?? "\(error)"
      result = toolResultJSON(["error": message])
      status = "failed"
      errorMessage = message
    }
    convoy.append(
      OpenCodeRequest.Message(role: "tool", content: result, toolCallID: call.id)
    )
    var record: [String: Any] = [
      "id": call.id,
      "name": call.function.name,
      "status": status,
      "output": result,
      "input": call.function.arguments,
    ]
    if let errorMessage { record["error"] = errorMessage }
    var activityPayload = [
      "name": call.function.name,
      "status": status,
      "input": call.function.arguments,
      "output": result,
    ]
    if let errorMessage { activityPayload["error"] = errorMessage }
    await checkpoint.finishTool(id: call.id, output: result, error: errorMessage)
    await onActivity(
      context.workspaceID,
      context.conversationID,
      context.agentID,
      MessageComponent(id: componentID, kind: "tool", payload: activityPayload)
    )
    print(
      "[Chief] agent \(context.agentID) tool \(call.function.name) \(status)"
    )
    logger.info(
      "agent \(context.agentID, privacy: .public) tool \(call.function.name, privacy: .public) \(status, privacy: .public)"
    )
    return record
  }

  private func complete(
    convoy: [OpenCodeRequest.Message],
    tools: [OpenCodeRequest.ToolDefinition],
    model: String,
    timeout: Int,
    onReasoning: @escaping @Sendable (String) async -> Void
  ) async throws -> OpenCodeStreamResult {
    guard let key = try credentials.load(.openCodeGo), !key.isEmpty else {
      throw WorkspaceSetupError.missingCredential
    }
    let body = try JSONEncoder().encode(
      OpenCodeRequest(
        model: model,
        messages: convoy,
        maxTokens: 1_800,
        tools: tools.isEmpty ? nil : tools,
        toolChoice: nil,
        stream: true
      )
    )
    let endpoint = OpenCodeModelCatalog.completionEndpoint(for: model)
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = TimeInterval(timeout)
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("Bearer \(key)", forHTTPHeaderField: "authorization")
    request.httpBody = body
    return try await OpenCodeStreamingClient.complete(
      request: request,
      onReasoning: onReasoning
    )
  }

  private static func providerErrorSummary(data: Data) -> String {
    guard
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let error = object["error"]
    else { return "" }
    let raw: String
    if let dictionary = error as? [String: Any] {
      raw = [dictionary["code"], dictionary["type"], dictionary["message"]]
        .compactMap { $0.map(String.init(describing:)) }
        .filter { !$0.isEmpty }
        .joined(separator: ": ")
    } else {
      raw = String(describing: error)
    }
    let singleLine = raw
      .replacingOccurrences(of: "\n", with: " ")
      .replacingOccurrences(of: "\r", with: " ")
    guard !singleLine.isEmpty else { return "" }
    return " (\(String(singleLine.prefix(240))))"
  }

  /// Convert the cell's durable transcript (JSON array of {role, content, at})
  /// into {role, content} pairs for the chat API, dropping reasoning/tool spam.
  private func loadConvoy(_ messagesJSON: String) throws -> [OpenCodeRequest.Message] {
    guard let data = messagesJSON.data(using: .utf8),
      let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    var result: [OpenCodeRequest.Message] = []
    for item in array.suffix(60) {
      guard let role = item["role"] as? String,
        let content = item["content"] as? String
      else { continue }
      switch role {
      case "user", "assistant", "system":
        result.append(OpenCodeRequest.Message(role: role, content: content))
      case "tool":
        if let observation = Self.durableToolObservation(content) {
          result.append(OpenCodeRequest.Message(role: "system", content: observation))
        }
      default:
        continue  // skip reasoning/tool noise
      }
    }
    return result
  }

  /// Split the one-agent/one-cell scope `workspaceId:agentId`.
  private static func scopeParts(_ scope: String) -> (String, String) {
    let parts = scope.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    let workspaceID = String(parts[0])
    let agentID = parts.count > 1 ? String(parts[1]) : "chief"
    return (workspaceID, agentID)
  }

  private static func conversationID(from messagesJSON: String) -> String {
    guard
      let data = messagesJSON.data(using: .utf8),
      let messages = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return "general" }
    return messages.reversed().compactMap { $0["conversationId"] as? String }.first
      ?? "general"
  }

  private static func latestUserTimestamp(from messagesJSON: String) -> Int64 {
    guard
      let data = messagesJSON.data(using: .utf8),
      let messages = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
      let raw = messages.reversed().first(where: { $0["role"] as? String == "user" })?["at"]
    else { return Int64(Date().timeIntervalSince1970 * 1_000) }
    if let value = raw as? NSNumber { return value.int64Value }
    return Int64(Date().timeIntervalSince1970 * 1_000)
  }

  private static func durableCompletedToolNames(from messagesJSON: String) -> Set<String> {
    guard
      let data = messagesJSON.data(using: .utf8),
      let messages = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    return Set(messages.compactMap { message in
      guard message["role"] as? String == "tool",
        let content = message["content"] as? String,
        let data = content.data(using: .utf8),
        let tool = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        tool["status"] as? String == "completed"
      else { return nil }
      return tool["name"] as? String
    })
  }

  private static func durableToolObservation(_ content: String) -> String? {
    guard let data = content.data(using: .utf8),
      let tool = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let name = tool["name"] as? String,
      let status = tool["status"] as? String
    else { return nil }
    let output = tool["output"] as? String ?? ""
    return "Durable replay: tool \(name) previously \(status). Its recorded output was:\n\(output)"
  }
}

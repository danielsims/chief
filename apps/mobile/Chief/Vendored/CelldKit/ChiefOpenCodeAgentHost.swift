import Foundation
import os

typealias AgentActivityCallback =
  @Sendable (
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
  private var lastPublishedAt: ContinuousClock.Instant?

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
    await AgentBackgroundActivityCoordinator.shared.modelProgressed(
      scope: "\(workspaceID):\(agentID):\(conversationID)"
    )
    await checkpoint.appendReasoning(id: componentID, delta: delta)
    let now = ContinuousClock.now
    if lastPublishedAt.map({ $0.duration(to: now) >= .milliseconds(160) }) ?? true {
      lastPublishedAt = now
      await publish(status: "working")
    }
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

/// Concrete host that runs inference through the selected provider and executes
/// the package-level relay tools natively (running them in an OpenAI-style
/// tool loop). Tool invocations are returned in the envelope's `tools` so the
/// worker persists them into the durable transcript, grounding the reply in
/// real workspace state.
actor ChiefAgentHost: ChiefAgentHosting {
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
    let (workspaceID, agentID) = Self.scopeParts(scope)
    let activityScope = Self.backgroundActivityScope(
      workspaceID: workspaceID,
      agentID: agentID,
      conversationID: conversationID
    )
    let agentName = WorkspaceAgentCatalog.agent(forID: agentID)?.name ?? agentID.capitalized
    await AgentBackgroundActivityCoordinator.shared.begin(
      scope: activityScope,
      workspaceID: workspaceID,
      conversationID: conversationID,
      agentName: agentName
    )
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
      await AgentBackgroundActivityCoordinator.shared.finish(
        scope: activityScope,
        outcome: .completed
      )
      return Self.envelope(reply: reply, tools: tools, activity: activity)
    } catch {
      logger.error("turn failed: \(error.localizedDescription)")
      print("[Chief] agent turn host failure: \(error.localizedDescription)")
      let failure = AgentRunFailure(error)
      await checkpoint.fail(failure)
      await AgentBackgroundActivityCoordinator.shared.finish(
        scope: activityScope,
        outcome: .paused
      )
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
    let conversationMessagesJSON = Self.conversationMessagesJSON(from: messagesJSON)
    let currentUserText = Self.latestUserContent(from: conversationMessagesJSON)
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
    guard
      let config = try await relay.loadAgentConfig(
        workspaceID: workspaceID,
        agentID: agentID
      )
    else {
      throw ToolError.permissionDenied("authoritative agent configuration")
    }
    AgentConfigStore().save(
      workspaceID: workspaceID,
      agentID: agentID,
      config: config
    )
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
      messagesJSON: conversationMessagesJSON
    )

    var convoy = [OpenCodeRequest.Message]()
    let attachedSkillID = AgentSkillBundle.resolvedSkillID(
      referencedBy: currentUserText,
      agentID: agentID
    )
    let attachedSkill = attachedSkillID.flatMap(AgentSkillBundle.instructions(skillID:))
    let packageInstructions = authoredPackage.instructions
    convoy.append(
      OpenCodeRequest.Message(
        role: "system",
        content: """
          You are \(agent.name), a \(agent.role) in a workspace owned by a builder. You speak for yourself and act under your own identity; never pretend to be the owner or another agent. Sound like a relaxed, thoughtful teammate in chat. Use natural contractions such as I'm, we'll, you're, and don't whenever they fit. Use sentence case, not stiff announcement language, and never use em dashes. When an instruction requires a relay action, you MUST call the corresponding relay tools before writing the final reply. Instructions and prior assistant claims are never proof that an action happened; only a successful tool result is proof. Do not claim work has happened unless that result exists. Match the response to the task: keep casual chat concise, but do substantive work fully. When the available tools can inspect, research, or persist what the user asked for, use them proactively before replying instead of returning a plan or describing what you could do.

          Use relay_reaction_add sparingly when a reaction is more natural than another acknowledgement. Never react to your own message and add at most one reaction to a user message.

          In user-visible messages, always write a known workspace channel as its #channel-slug, including private channels such as #setup, so Chief can render a navigable channel reference. Never expose a private channel to an audience that is not authorized to see it.

          Canonical agent package instructions:
          \(packageInstructions)

          iOS host binding map: browser_navigate/browser_snapshot/browser_click/browser_type/browser_scroll/browser_back/browser_release are the visible native browser. brand_profile_save fulfills both localTools.brandProfileSave and the editable brand-profile file write. prospects_list and prospects_save fulfill the corresponding local workspace data operations. The relay collaboration tools fulfill the channel and message operations. The canonical plugin tools are plugins_list, plugins_recommend, plugins_install, plugins_authorize, and plugins_uninstall. Every agent can discover, recommend, install, authorize, and use plugins after the user approves the connection card. When a user asks to see plugins, call plugins_list and then plugins_recommend so the chat receives real clickable cards instead of a prose-only list. Prefer an already connected plugin, then a catalog plugin and its native authorization flow, then another structured Executor-style connection. Use the browser only when no structured connection can perform the task or when a provider requires a visible human sign-in or credential step. Never start with browser research for a service represented by an available plugin. A package instruction never grants a tool: only the tools advertised for this turn are available.

          Browser research runs in your own isolated on-device WebKit session. Start with browser_navigate, inspect every loaded page with browser_snapshot, use only evidence actually present in snapshots, and finish browser work with browser_release. Every browser action requires an activityLabel: write a specific two-to-five-word present-tense label, no more than 48 characters, describing the visible purpose of that action. Never put secrets or typed values in it. Stay focused: for onboarding, inspect at most three useful pages and use at most ten browser action calls. Persist the requested workspace result before releasing the browser. Never invent a page, claim, person, company, quotation, or URL.

          Authoritative workspace context from onboarding:
          \(workspaceContext.systemPrompt)

          Conversation boundary: your final text is automatically published
          back into the owning conversation (\(conversationID)). Do not call
          relay_message_post merely to answer the current user. Use it only for
          genuine cross-channel collaboration. You are the same durable agent
          across every channel: use the cell-continuity record to resume your
          own prior work, while keeping each channel's transcript and audience
          separate. Persist durable workspace facts through the available data
          tools rather than relying on chat recollection alone. Never poll relay
          reads for new data inside a turn or repeat an identical read while
          waiting. Live relay events deliver later changes; if work is still
          running, say so and finish the current response.

          \(attachedSkill.map { "Attached skill instructions:\n\($0)" } ?? "")

          \(existingBrandProfile.map { "Current shared workspace brand profile:\n\($0.markdown)" } ?? "")
          """
      )
    )
    convoy.append(contentsOf: try loadConvoy(messagesJSON))

    var toolRecords: [[String: Any]] = []
    var activityRecords: [[String: Any]] = []
    var completedToolNames = Self.durableCompletedToolNames(from: conversationMessagesJSON)
    let requiresSpecialistKickoffTools = currentUserText.contains(
      "MUST call relay_channels_create"
    )
    let requiresChiefDelegationTools = currentUserText.contains(
      "CHIEF_DELEGATION_REQUIRED"
    )
    var requiredTools: Set<String> =
      requiresSpecialistKickoffTools
      ? KickoffToolEvidence.specialistRequiredTools
      : requiresChiefDelegationTools
        ? KickoffToolEvidence.chiefRequiredTools
        : []
    if attachedSkillID == "build-brand-profile" {
      requiredTools.formUnion([
        BrowserNavigateTool.name,
        BrowserSnapshotTool.name,
        BrandProfileSaveTool.name,
        BrowserReleaseTool.name,
      ])
    }
    if attachedSkillID == "find-buying-signals" {
      requiredTools.formUnion([
        BrowserNavigateTool.name,
        BrowserSnapshotTool.name,
        ProspectsListTool.name,
        ProspectSaveTool.name,
        BrowserReleaseTool.name,
      ])
    }
    let attachedSkillIDs = Set(attachedSkillID.map { [$0] } ?? [])
    let requestedToolNames = AgentTurnToolPolicy.names(
      requiresChiefDelegation: requiresChiefDelegationTools,
      requiresSpecialistKickoff: requiresSpecialistKickoffTools,
      attachedSkillIDs: attachedSkillIDs,
      agentID: agentID
    )
    let grant = AgentToolAuthorization.grant(
      requestedToolNames: requestedToolNames,
      config: config
    )
    let deniedRequiredTools = requiredTools.subtracting(grant.toolNames)
    guard deniedRequiredTools.isEmpty else {
      throw ToolError.permissionDenied(
        deniedRequiredTools.sorted().joined(separator: ", ")
      )
    }
    var definitions = RelayToolRegistry.openAIDefinitions(
      allowing: grant.toolNames
    )
    if grant.permits(toolName: PluginsListTool.name) {
      let pluginTools = await MobilePluginRuntime.shared.toolDefinitions(workspaceID: workspaceID)
      definitions.append(
        contentsOf: pluginTools.map { $0.openCodeDefinition() }
      )
    }
    let context = ToolContext(
      relay: relay,
      identity: identity,
      agentID: agentID,
      workspaceID: workspaceID,
      conversationID: conversationID,
      grant: grant
    )
    await MainActor.run {
      AgentBrowserSession.beginTurn(for: context.browserScope)
    }
    var timeout = 90
    var observationRevision = 0
    var completedReadFingerprints = Set<String>()
    var rejectedReadFingerprints = Set<String>()

    for _ in 0..<Self.maxToolRounds {
      let needsRequiredTool = !requiredTools.isSubset(of: completedToolNames)
      let reasoning = ReasoningActivityEmitter(
        workspaceID: workspaceID,
        conversationID: conversationID,
        agentID: agentID,
        checkpoint: checkpoint,
        callback: onActivity
      )
      await AgentBackgroundActivityCoordinator.shared.modelStarted(
        scope: Self.backgroundActivityScope(
          workspaceID: workspaceID,
          agentID: agentID,
          conversationID: conversationID
        )
      )
      let result = try await complete(
        convoy: convoy,
        tools: definitions,
        workspaceID: workspaceID,
        inference: config.inference,
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
          var preflightError: Error?
          if AgentTurnToolPolicy.isReadOnly(call.function.name) {
            let fingerprint = Self.toolFingerprint(
              name: call.function.name,
              arguments: call.function.arguments,
              observationRevision: observationRevision
            )
            if !completedReadFingerprints.insert(fingerprint).inserted {
              guard rejectedReadFingerprints.insert(fingerprint).inserted else {
                throw ToolError.invalidArgument(
                  "The same unchanged read was requested repeatedly. Relay polling is not allowed."
                )
              }
              preflightError = ToolError.invalidArgument(
                "This unchanged read already completed. Do not poll it; answer from the current evidence."
              )
            }
          } else {
            observationRevision += 1
          }
          let record = try await executeTool(
            call,
            convoy: &convoy,
            context: context,
            checkpoint: checkpoint,
            completedToolNames: completedToolNames,
            releasePrerequisites: requiredTools.intersection([
              BrandProfileSaveTool.name,
              ProspectSaveTool.name,
            ]),
            preflightError: preflightError
          )
          toolRecords.append(record)
          activityRecords.append(["kind": "tool", "tool": record])
          if record["status"] as? String == "completed",
            let name = record["name"] as? String
          {
            completedToolNames.insert(name)
          }
          if preflightError != nil {
            convoy.append(
              OpenCodeRequest.Message(
                role: "system",
                content:
                  "Relay polling is blocked by the phone runtime. Do not repeat that read. Return a concise final response now using the evidence already available."
              )
            )
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
        let missing =
          requiredTools
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
    releasePrerequisites: Set<String>,
    preflightError: Error? = nil
  ) async throws -> [String: Any] {
    let activityScope = Self.backgroundActivityScope(
      workspaceID: context.workspaceID,
      agentID: context.agentID,
      conversationID: context.conversationID
    )
    await AgentBackgroundActivityCoordinator.shared.toolStarted(
      scope: activityScope,
      name: call.function.name
    )
    if call.function.name.hasPrefix("browser_"),
      let argumentsData = call.function.arguments.data(using: .utf8),
      let arguments = try? JSONSerialization.jsonObject(with: argumentsData) as? [String: Any],
      let label = arguments["activityLabel"] as? String
    {
      await AgentBackgroundActivityCoordinator.shared.browserActionStarted(
        scope: activityScope,
        label: label
      )
    }
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
      if let preflightError { throw preflightError }
      if call.function.name == BrowserReleaseTool.name,
        !releasePrerequisites.isSubset(of: completedToolNames)
      {
        throw ToolError.invalidArgument(
          "browser_release must follow the required durable save"
        )
      }
      let output: String
      if context.grant.permits(toolName: PluginsListTool.name),
        let pluginOutput = try await MobilePluginRuntime.shared.execute(
          name: call.function.name,
          argumentsJSON: call.function.arguments,
          workspaceID: context.workspaceID
        )
      {
        output = pluginOutput
      } else {
        output = try await RelayToolRegistry.execute(
          name: call.function.name,
          arguments: call.function.arguments,
          context: context
        )
      }
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
    workspaceID: String,
    inference: AgentInferenceConfig,
    timeout: Int,
    onReasoning: @escaping @Sendable (String) async -> Void
  ) async throws -> OpenCodeStreamResult {
    #if DEBUG
      // A paired Mac is a disposable development inference transport only.
      // Agent configuration, identity, durable history, permissions, and tool
      // execution remain owned by this cell on the iPhone.
      if DevCodexBridgeSettings.isEnabled(for: workspaceID),
        DevCodexBridgeSettings.isConfigured,
        let token = try credentials.load(.codexBridge),
        !token.isEmpty
      {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let transcriptJSON = String(decoding: try encoder.encode(convoy), as: UTF8.self)
        let toolDefinitionsJSON = String(decoding: try encoder.encode(tools), as: UTF8.self)
        let completion = try await DevCodexBridgeClient.complete(
          transcriptJSON: transcriptJSON,
          toolDefinitionsJSON: toolDefinitionsJSON,
          allowedTools: Set(tools.map(\.function.name)),
          model: DevCodexBridgeSettings.model,
          capabilityToken: token,
          onReasoning: onReasoning
        )
        guard
          let response = HTTPURLResponse(
            url: DevCodexBridgeSettings.endpoint!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: nil
          )
        else { throw WorkspaceSetupError.inferenceFailed }
        return OpenCodeStreamResult(
          response: response,
          content: completion.content,
          toolCalls: completion.toolCalls,
          errorBody: Data()
        )
      }
    #endif
    let provider: OnboardingDraft.InferenceProvider
    let endpoint: URL
    switch inference.provider {
    case "opencode":
      provider = .openCodeGo
      endpoint = OpenCodeModelCatalog.completionEndpoint(for: inference.model)
    case "vercel-ai-gateway":
      provider = .vercelAiGateway
      endpoint = URL(string: "https://ai-gateway.vercel.sh/v1/chat/completions")!
    default:
      throw WorkspaceSetupError.unsupportedInference
    }
    guard let key = try credentials.load(provider), !key.isEmpty else {
      throw WorkspaceSetupError.missingCredential
    }
    let body = try JSONEncoder().encode(
      OpenCodeRequest(
        model: inference.model,
        messages: convoy,
        maxTokens: 1_800,
        tools: tools.isEmpty ? nil : tools,
        toolChoice: nil,
        stream: true
      )
    )
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
    let singleLine =
      raw
      .replacingOccurrences(of: "\n", with: " ")
      .replacingOccurrences(of: "\r", with: " ")
    guard !singleLine.isEmpty else { return "" }
    return " (\(String(singleLine.prefix(240))))"
  }

  private static func toolFingerprint(
    name: String,
    arguments: String,
    observationRevision: Int
  ) -> String {
    let normalized: String
    if let data = arguments.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data),
      let canonical = try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
      )
    {
      normalized = String(decoding: canonical, as: UTF8.self)
    } else {
      normalized = arguments.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return "\(observationRevision):\(name):\(normalized)"
  }

  /// Convert the cell's durable transcript (JSON array of {role, content, at})
  /// into {role, content} pairs for the chat API, dropping reasoning/tool spam.
  private func loadConvoy(_ messagesJSON: String) throws -> [OpenCodeRequest.Message] {
    guard let data = messagesJSON.data(using: .utf8),
      let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    var result: [OpenCodeRequest.Message] = []
    if let continuity = array.last(where: { $0["agentContinuity"] as? Bool == true }),
      let content = continuity["content"] as? String
    {
      result.append(OpenCodeRequest.Message(role: "system", content: content))
    }
    for item in array.filter({ $0["agentContinuity"] as? Bool != true }).suffix(60) {
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

  private static func backgroundActivityScope(
    workspaceID: String,
    agentID: String,
    conversationID: String
  ) -> String {
    "\(workspaceID):\(agentID):\(conversationID)"
  }

  private static func conversationID(from messagesJSON: String) -> String {
    guard
      let data = messagesJSON.data(using: .utf8),
      let messages = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return "general" }
    return messages.reversed().compactMap { $0["conversationId"] as? String }.first
      ?? "general"
  }

  /// Remove host-injected agent continuity before applying turn-local
  /// capability rules. Historical context can inform the model, but it must
  /// never re-attach an old skill or widen the current executor grant.
  private static func conversationMessagesJSON(from messagesJSON: String) -> String {
    guard let data = messagesJSON.data(using: .utf8),
      let messages = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
      let filtered = try? JSONSerialization.data(
        withJSONObject: messages.filter { $0["agentContinuity"] as? Bool != true }
      )
    else { return messagesJSON }
    return String(decoding: filtered, as: UTF8.self)
  }

  private static func latestUserContent(from messagesJSON: String) -> String {
    guard let data = messagesJSON.data(using: .utf8),
      let messages = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return "" }
    return messages.reversed().first(where: { $0["role"] as? String == "user" })?["content"]
      as? String ?? ""
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
    return Set(
      messages.compactMap { message in
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

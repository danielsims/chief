import Foundation

actor PhoneWorkspaceSetupWorker {
  private let relay: any RelayServing
  private let credentials: InferenceCredentialStore
  private let session: URLSession

  init(
    relay: any RelayServing,
    credentials: InferenceCredentialStore,
    session: URLSession = .shared
  ) {
    self.relay = relay
    self.credentials = credentials
    self.session = session
  }

  func run(draft: OnboardingDraft, workspaceID: String) async throws {
    guard draft.runtime == .phone else { return }
    guard draft.inferenceProvider == .openCodeGo else {
      throw WorkspaceSetupError.unsupportedInference
    }
    print("[Chief] phone worker credential state: \(credentials.contains(.openCodeGo))")
    guard let lease = try await claim(workspaceID: workspaceID) else {
      throw WorkspaceSetupError.missingJob
    }
    print("[Chief] phone worker claimed \(lease.job.kind)")
    let message = await openingMessage(draft: draft)
    print("[Chief] phone worker prepared opening (\(message.count) chars)")
    try await relay.completeAgentJob(
      workspaceID: workspaceID,
      agentID: "chief",
      leaseToken: lease.leaseToken,
      completion: AgentJobCompletion(
        openingMessage: message,
        publishedMessage: AgentPublishedMessage(
          conversationId: "mission-control",
          body: message
        )
      )
    )
    print("[Chief] phone worker completed \(lease.job.kind)")
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

  /// Best-effort inference. On failure this returns a short, accurate fallback
  /// so onboarding always lands in a live workspace instead of dead-ending.
  private func openingMessage(draft: OnboardingDraft) async -> String {
    if let generated = try? await generatedOpeningMessage(draft: draft), !generated.isEmpty {
      return generated
    }
    let apps = draft.selectedApps.sorted().joined(separator: ", ")
    if !apps.isEmpty {
      return "Your \(draft.companyName) workspace is live. I'll get oriented and look at \(apps) first — specialists will join as useful work is identified."
    }
    return "Your \(draft.companyName) workspace is live. I'll get oriented and find the first useful work to start on."
  }

  private func generatedOpeningMessage(draft: OnboardingDraft) async throws -> String {
    try Task.checkCancellation()
    guard draft.inferenceProvider == .openCodeGo else {
      throw WorkspaceSetupError.unsupportedInference
    }
    guard let key = try credentials.load(.openCodeGo), !key.isEmpty else {
      throw WorkspaceSetupError.missingCredential
    }
    let endpoint = URL(string: "https://opencode.ai/zen/go/v1/chat/completions")!
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = 60
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("Bearer \(key)", forHTTPHeaderField: "authorization")
    request.httpBody = try JSONEncoder().encode(
      OpenCodeRequest(
        model: draft.inferenceModel,
        messages: [
          .init(
            role: "system",
            content: """
            You are Chief, a concise and proactive chief of staff. Write naturally and conversationally. Never use em dashes. Do not claim work has happened unless the supplied setup proves it. Return only the opening message.
            """
          ),
          .init(
            role: "user",
            content: """
            Start the mission-control channel for \(draft.companyName). The company website is \(draft.website.isEmpty ? "not supplied" : draft.website). The user selected these apps: \(draft.selectedApps.sorted().joined(separator: ", ")). Briefly confirm that the workspace is live, say what you will inspect first, and explain that relevant specialists will appear as useful work is identified. Keep it to 2 or 3 short sentences.
            """
          ),
        ],
        maxTokens: 220
      )
    )
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw WorkspaceSetupError.inferenceFailed
    }
    let output = try JSONDecoder().decode(OpenCodeResponse.self, from: data)
    guard let message = output.choices.first?.message.content
      .trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty
    else {
      throw WorkspaceSetupError.inferenceFailed
    }
    return message
  }
}

enum WorkspaceSetupError: LocalizedError {
  case inferenceFailed
  case missingCredential
  case missingJob
  case unsupportedInference

  var errorDescription: String? {
    switch self {
    case .inferenceFailed: "Chief could not finish the first setup response. Try again."
    case .missingCredential: "Reconnect OpenCode Go to start Chief on this iPhone."
    case .missingJob: "Chief's setup job was not available. Try again."
    case .unsupportedInference: "This on-device model cannot run Chief yet."
    }
  }
}

struct OpenCodeRequest: Encodable {
  struct Message: Encodable {
    let role: String
    let content: String
  }
  let model: String
  let messages: [Message]
  let maxTokens: Int

  enum CodingKeys: String, CodingKey {
    case model, messages
    case maxTokens = "max_tokens"
  }
}

struct OpenCodeResponse: Decodable {
  struct Choice: Decodable {
    struct Message: Decodable { let content: String }
    let message: Message
  }
  let choices: [Choice]
}

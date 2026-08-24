import Foundation

/// Authoritative onboarding context supplied to every agent cell. Relay state
/// wins; the durable kickoff message is a compatibility fallback for snapshots
/// created before workspace context became first-class.
struct AgentWorkspaceContext: Sendable {
  let name: String
  let website: String?
  let selectedApps: [String]

  static func resolve(
    workspace: WorkspaceSnapshot?,
    expectedWorkspaceID: String,
    messagesJSON: String
  ) -> AgentWorkspaceContext {
    let fallback = fromTranscript(messagesJSON)
    guard let workspace, workspace.id == expectedWorkspaceID else {
      return fallback
    }
    return AgentWorkspaceContext(
      name: workspace.name,
      website: validatedWebsite(workspace.website) ?? fallback.website,
      selectedApps: workspace.selectedApps ?? fallback.selectedApps
    )
  }

  var systemPrompt: String {
    let site = website.map {
      "Primary company website: \($0)\nUse this exact site as the starting point for company research. Never substitute example.com or another placeholder."
    } ?? "Primary company website: not supplied. Ask for it when research requires it; never substitute a placeholder URL."
    let apps = selectedApps.isEmpty
      ? "Selected apps: none supplied. Do not infer or recommend a default provider during initial onboarding."
      : "Selected apps (relevance context only, not proof of access): \(selectedApps.joined(separator: ", ")). Treat every selection as relevant, but never claim it is connected or open sign-in without the user."
    return """
      Workspace name: \(name)
      \(site)
      \(apps)
      Treat this onboarding context as authoritative for this workspace and keep it isolated from every other workspace. Never ask for information this context already answers.
      In user-visible messages, always write a known workspace channel as its #channel-slug, including private channels such as #setup, so Chief can render a navigable channel reference. Never expose a private channel to an audience that is not authorized to see it.
      Setup intentionally did not collect a full positioning, audience, voice, or customer brief. Research the supplied website and first-party evidence before asking anything. If one genuinely missing answer would materially change the work, ask one focused question in your own channel after completing every safe independent step. Do not turn onboarding into an intake questionnaire.
      """
  }

  private static func fromTranscript(_ messagesJSON: String) -> AgentWorkspaceContext {
    guard let data = messagesJSON.data(using: .utf8),
      let messages = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else {
      return AgentWorkspaceContext(name: "This workspace", website: nil, selectedApps: [])
    }
    let contents = messages.compactMap { $0["content"] as? String }.reversed()
    var name: String?
    var website: String?
    var apps: [String] = []
    for content in contents {
      for line in content.split(separator: "\n").map(String.init) {
        if name == nil, line.hasPrefix("Workspace: ") {
          name = String(line.dropFirst("Workspace: ".count)).trimmingCharacters(
            in: .whitespacesAndNewlines
          )
        } else if website == nil, line.hasPrefix("Website: ") {
          website = validatedWebsite(String(line.dropFirst("Website: ".count)))
        } else if apps.isEmpty, line.hasPrefix("Selected apps (relevance only): ") {
          apps = String(line.dropFirst("Selected apps (relevance only): ".count))
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        }
      }
      if name != nil, website != nil { break }
    }
    let resolvedName = name.flatMap { $0.isEmpty ? nil : $0 } ?? "This workspace"
    return AgentWorkspaceContext(
      name: resolvedName,
      website: website,
      selectedApps: apps
    )
  }

  private static func validatedWebsite(_ raw: String?) -> String? {
    guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
      !raw.isEmpty,
      let components = URLComponents(string: raw),
      components.scheme == "https" || components.scheme == "http",
      components.host != nil,
      components.user == nil,
      components.password == nil
    else { return nil }
    return raw
  }
}

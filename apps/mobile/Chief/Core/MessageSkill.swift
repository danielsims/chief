import Foundation

struct MessageSkill: Identifiable, Equatable, Sendable {
  let id: String
  let label: String
  let agentID: String?
}

enum MessageSkillCatalog {
  static let skills = [
    MessageSkill(id: "build-brand-profile", label: "Build brand profile", agentID: "brand"),
    MessageSkill(id: "find-buying-signals", label: "Find buying signals", agentID: "prospector"),
    MessageSkill(id: "setup-google-analytics", label: "Connect Google Analytics", agentID: "setup"),
    MessageSkill(id: "setup-github", label: "Set up GitHub", agentID: "setup"),
    MessageSkill(id: "setup-vercel", label: "Set up Vercel", agentID: "setup"),
    MessageSkill(id: "setup-integration", label: "Set up integration", agentID: "setup"),
  ]

  static func skill(forID id: String) -> MessageSkill {
    skills.first { $0.id == id }
      ?? MessageSkill(id: id, label: humanize(id), agentID: nil)
  }

  private static func humanize(_ value: String) -> String {
    value.split(separator: "-").map { part in
      part.prefix(1).uppercased() + part.dropFirst()
    }.joined(separator: " ")
  }
}

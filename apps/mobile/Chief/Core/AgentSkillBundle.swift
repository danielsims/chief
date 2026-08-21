import Foundation

/// Resolves the same canonical SKILL.md files that back the desktop agents.
/// Xcode copies the source directories as folders, so mobile does not maintain
/// a divergent second set of skill instructions.
enum AgentSkillBundle {
  static func instructions(referencedBy messagesJSON: String, agentID: String) -> String? {
    guard let id = resolvedSkillID(referencedBy: messagesJSON, agentID: agentID) else {
      return nil
    }
    return instructions(skillID: id)
  }

  /// A skill reference is an instruction for its catalog owner only. Chief's
  /// delegation message deliberately contains specialist skill chips, but
  /// those references must never widen Chief's own turn capabilities.
  static func resolvedSkillID(referencedBy messagesJSON: String, agentID: String) -> String? {
    skillIDs(in: messagesJSON).first {
      MessageSkillCatalog.skill(forID: $0).agentID == agentID
    }
  }

  static func instructions(skillID: String) -> String? {
    let skill = MessageSkillCatalog.skill(forID: skillID)
    guard let agentID = skill.agentID,
      skillID.range(of: #"^[a-z0-9]+(?:-[a-z0-9]+)*$"#, options: .regularExpression) != nil,
      let url = Bundle.main.url(
        forResource: "SKILL",
        withExtension: "md",
        subdirectory: "agents/\(agentID)/skills/\(skillID)"
      ),
      let source = try? String(contentsOf: url, encoding: .utf8)
    else { return nil }
    return source.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func skillIDs(in value: String) -> [String] {
    guard let expression = try? NSRegularExpression(
      pattern: #"\[chief-skill:([a-z0-9]+(?:-[a-z0-9]+)*)\]"#,
      options: [.caseInsensitive]
    ) else { return [] }
    let range = NSRange(value.startIndex..., in: value)
    return expression.matches(in: value, range: range).compactMap { match in
      guard let idRange = Range(match.range(at: 1), in: value) else { return nil }
      return String(value[idRange]).lowercased()
    }
  }
}

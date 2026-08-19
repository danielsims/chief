import Foundation

/// The workspace agent identities the composer can @-mention, mirroring the
/// desktop's `WORKSPACE_AGENT_IDENTITIES`.
struct MentionAgent: Identifiable, Equatable, Sendable {
  let id: String
  let name: String
  let role: String
}

enum WorkspaceAgentCatalog {
  static let agents: [MentionAgent] = [
    .init(id: "chief", name: "Chief", role: "Workspace Lead"),
    .init(id: "setup", name: "Setup", role: "Private Workspace Setup"),
    .init(id: "analyst", name: "Analyst", role: "Measurement and Reporting"),
    .init(id: "ads", name: "Advertising", role: "Paid Acquisition"),
    .init(id: "content", name: "Content", role: "Content and Creative"),
    .init(id: "prospector", name: "Prospector", role: "Research and Outreach"),
    .init(id: "brand", name: "Marketer", role: "Marketing"),
    .init(id: "engineer", name: "Engineer", role: "Product Engineering"),
  ]

  static func agent(forID id: String) -> MentionAgent? {
    agents.first { $0.id.lowercased() == id.lowercased() }
  }

  /// The display names + ids that a plain `@Name` resolves to, lowercased.
  static func matching(prefix: String) -> [MentionAgent] {
    guard !prefix.isEmpty else { return agents }
    let query = prefix.lowercased()
    return agents.filter {
      $0.id.lowercased().hasPrefix(query)
        || $0.name.lowercased().hasPrefix(query)
        || $0.name.lowercased().contains(query)
    }
  }
}

enum AgentMentionParser {
  struct Segment: Equatable, Sendable {
    enum Kind: Equatable, Sendable { case text, mention }
    let kind: Kind
    let value: String
    let agentID: String?
  }

  /// Splits a draft into text + mention segments so the composer can render
  /// `@Chief` as a chip and the sender can record who was addressed.
  static func split(_ text: String) -> [Segment] {
    var segments: [Segment] = []
    let nsRange = NSRange(text.startIndex..., in: text)
    let matches = mentionPattern.matches(in: text, options: [], range: nsRange)
    var cursor = text.startIndex

    for match in matches {
      guard let range = Range(match.range, in: text) else { continue }
      if range.lowerBound > cursor {
        segments.append(
          Segment(kind: .text, value: String(text[cursor..<range.lowerBound]), agentID: nil)
        )
      }
      let token = String(text[range])
      let name = String(token.dropFirst())
      if let agent = WorkspaceAgentCatalog.agent(forID: name) {
        segments.append(Segment(kind: .mention, value: token, agentID: agent.id))
      } else {
        segments.append(Segment(kind: .text, value: token, agentID: nil))
      }
      cursor = range.upperBound
    }
    if cursor < text.endIndex {
      segments.append(Segment(kind: .text, value: String(text[cursor...]), agentID: nil))
    }
    return segments.isEmpty ? [Segment(kind: .text, value: text, agentID: nil)] : segments
  }

  /// The agent ids addressed in a draft (deduplicated, in order).
  static func mentions(in text: String) -> [String] {
    var seen = Set<String>()
    return split(text).compactMap { segment in
      guard segment.kind == .mention, let id = segment.agentID else { return nil }
      return seen.insert(id).inserted ? id : nil
    }
  }

  private static var mentionPattern: NSRegularExpression {
    let names = WorkspaceAgentCatalog.agents.flatMap { [$0.id, $0.name] }
      .sorted { $0.count > $1.count }
    let escaped = names
      .map { NSRegularExpression.escapedPattern(for: $0) }
      .joined(separator: "|")
    return try! NSRegularExpression(
      pattern: "(?<![\\p{L}\\p{N}_])@(?:\(escaped))(?![\\p{L}\\p{N}_-])",
      options: [.caseInsensitive]
    )
  }
}

extension String {
  /// First mention agent id, or nil. Used to decide who to wake.
  var firstMentionedAgentID: String? {
    AgentMentionParser.mentions(in: self).first
  }
}

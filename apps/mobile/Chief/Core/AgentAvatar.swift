import Foundation

/// How an agent appears, mirroring the relay's `agentAvatarSchema`. Images and
/// sprites always point at the relay's own copy of the file.
enum AgentAvatar: Codable, Equatable, Sendable {
  case image(url: URL)
  /// A grid sheet whose first `frames`, read row by row, loop as the idle
  /// animation.
  case sprite(url: URL, columns: Int, rows: Int, frames: Int, fps: Int)
  case style(color: String, shape: Shape, glyph: String?)

  enum Shape: String, Codable, Sendable { case circle, rounded, square }

  private enum CodingKeys: String, CodingKey {
    case kind, url, columns, rows, frames, fps, color, shape, glyph
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(String.self, forKey: .kind) {
    case "image":
      self = .image(url: try container.decode(URL.self, forKey: .url))
    case "sprite":
      self = .sprite(
        url: try container.decode(URL.self, forKey: .url),
        columns: try container.decode(Int.self, forKey: .columns),
        rows: try container.decode(Int.self, forKey: .rows),
        frames: try container.decode(Int.self, forKey: .frames),
        fps: try container.decode(Int.self, forKey: .fps)
      )
    case "style":
      self = .style(
        color: try container.decode(String.self, forKey: .color),
        shape: try container.decode(Shape.self, forKey: .shape),
        glyph: try container.decodeIfPresent(String.self, forKey: .glyph)
      )
    case let kind:
      throw DecodingError.dataCorruptedError(
        forKey: .kind,
        in: container,
        debugDescription: "Unknown avatar kind \(kind)"
      )
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .image(let url):
      try container.encode("image", forKey: .kind)
      try container.encode(url, forKey: .url)
    case .sprite(let url, let columns, let rows, let frames, let fps):
      try container.encode("sprite", forKey: .kind)
      try container.encode(url, forKey: .url)
      try container.encode(columns, forKey: .columns)
      try container.encode(rows, forKey: .rows)
      try container.encode(frames, forKey: .frames)
      try container.encode(fps, forKey: .fps)
    case .style(let color, let shape, let glyph):
      try container.encode("style", forKey: .kind)
      try container.encode(color, forKey: .color)
      try container.encode(shape, forKey: .shape)
      try container.encodeIfPresent(glyph, forKey: .glyph)
    }
  }
}

extension WorkspaceSnapshot {
  /// Every agent's avatar by id and by lowercased name, since views identify
  /// agents by either.
  var agentAvatars: [String: AgentAvatar] {
    var avatars: [String: AgentAvatar] = [:]
    for agent in agents {
      let profiles: [(String, String, AgentAvatar?)] =
        [(agent.id, agent.name, agent.avatar)]
        + agent.subagents.map { ($0.id, $0.name, $0.avatar) }
      for (id, name, avatar) in profiles {
        guard let avatar else { continue }
        avatars[id] = avatar
        avatars[name.lowercased()] = avatar
      }
    }
    return avatars
  }
}

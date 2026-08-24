import ActivityKit
import Foundation

/// Privacy-safe state shared with the Live Activity extension. Prompts,
/// reasoning, tool arguments, tool output, URLs, and credentials never cross
/// the widget boundary or appear on the Lock Screen.
struct ChiefAgentActivityAttributes: ActivityAttributes {
  static let workInProgressSubtitle = "Agent work in progress"

  struct ContentState: Codable, Hashable {
    enum Phase: String, Codable, Hashable {
      case thinking
      case usingTool
      case completed
      case paused
    }

    var phase: Phase
    var status: String
    var detail: String
    var actionCount: Int
  }

  let workspaceID: String
  let conversationID: String
  let agentName: String
  let startedAt: Date
}

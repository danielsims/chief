import Foundation

struct ScheduledRunReference: Equatable, Sendable {
  let runID: String
  let scheduleID: String
  let title: String
  let agentIDs: [String]

  init?(message: ConversationMessage) {
    guard case .system = message.author,
      let component = message.components.first(where: { $0.kind == "schedule.run" }),
      let runID = component.payload["runId"], !runID.isEmpty,
      let scheduleID = component.payload["scheduleId"], !scheduleID.isEmpty,
      let title = component.payload["title"], !title.isEmpty
    else { return nil }
    self.runID = runID
    self.scheduleID = scheduleID
    self.title = title
    self.agentIDs = component.payloadArrays["agentIds"] ?? []
  }
}

struct WorkspaceScheduleRun: Codable, Equatable, Identifiable, Sendable {
  struct Team: Codable, Equatable, Sendable {
    let agentId: String
    let collaborators: [String]
    let conversationId: String
  }
  struct Step: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let agentId: String
    let phase: String
    let state: String
    let assignment: String?
    let evidence: String?
    let error: String?
  }
  let id: String
  let scheduleId: String
  let threadRootId: String
  let state: String
  let schedule: Team
  let steps: [Step]
  let summary: String?

  var isActive: Bool { state == "queued" || state == "running" }
  var agentIDs: [String] {
    var seen = Set<String>()
    return ([schedule.agentId] + schedule.collaborators).filter { seen.insert($0).inserted }
  }
  var workingAgentIDs: [String] {
    guard state == "running" else { return [] }
    var seen = Set<String>()
    return steps.filter { $0.state == "running" }.map(\.agentId).filter { seen.insert($0).inserted }
  }
}

struct WorkspaceScheduleRunList: Decodable { let runs: [WorkspaceScheduleRun] }

extension WorkspaceSnapshot {
  func agentDisplayName(_ id: String) -> String? {
    agents.compactMap { $0.profile(id: id)?.name }.first
      ?? WorkspaceAgentCatalog.agent(forID: id)?.name
  }
}

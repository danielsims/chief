import Foundation

struct WorkspaceScheduleProposeTool: RelayTool {
  static let name = "workspace_schedule_propose"
  static let description =
    "Configure a durable team schedule in the relay. Supports cron, one-time and webhook triggers, collaborators, missionId, instructions, outcome, constraints, run limit and skipDates. Set newChannel to {} for automatic mission-channel creation, or include name and inviteUserIds. The relay enforces membership and messaging permissions. The user must approve the latest proposal before it runs."
  static let parameters: [RelayToolParameter] = [
    .init(
      name: "schedule", kind: .string,
      description:
        "JSON object with stable id, title, agentId, instructions and timezone. Optional: conversationId, collaborators (agent IDs), newChannel ({name?, inviteUserIds?}), missionId, cron (five fields), onceAt (Unix milliseconds or ISO datetime), triggerMode (cron or webhook), expectedOutcome, constraints, maxDurationMinutes, skipDates (YYYY-MM-DD), approvalSummary and proposedToolPatterns. Omitted conversationId uses this conversation."
    )
  ]
  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let raw = try arguments.requiredString("schedule")
    guard raw.utf8.count <= 32_000, let data = raw.data(using: .utf8) else {
      throw ToolError.invalidArgument("schedule")
    }
    var input = try JSONDecoder().decode([String: JSONValue].self, from: data)
    if input["conversationId"] == nil { input["conversationId"] = .string(context.conversationID) }
    let result = try await context.relay.proposeSchedule(
      workspaceID: context.workspaceID, input: input, signingIdentity: context.identity)
    return String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
  }
}

struct ScheduleRunCollaboratorTool: RelayTool {
  static let name = "missions_addRunCollaborator"
  static let description =
    "Lead only: add a teammate with a concrete assignment to this active scheduled run. The relay queues their work in the run thread. Finish your current turn after a successful handoff. Repeating the same assignment is safe. This does not change the recurring schedule or grant new permissions."
  static let parameters: [RelayToolParameter] = [
    .init(name: "runId", kind: .string, description: "Current scheduled run ID"),
    .init(name: "agentId", kind: .string, description: "Workspace agent to assign"),
    .init(
      name: "assignment", kind: .string,
      description: "Concrete work and deliverable, up to 4000 characters"),
  ]
  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let result = try await context.relay.addRunCollaborator(
      workspaceID: context.workspaceID, runID: arguments.requiredString("runId"),
      agentID: arguments.requiredString("agentId"),
      assignment: arguments.requiredString("assignment"), signingIdentity: context.identity)
    return String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
  }
}

struct ScheduleRunReportTool: RelayTool {
  static let name = "missions_reportRunStep"
  static let description =
    "Report your assigned scheduled run step as completed or blocked, with evidence linking the saved work or explaining the blocker. Only the assigned agent can report the step."
  static let parameters: [RelayToolParameter] = [
    .init(name: "runId", kind: .string, description: "Current scheduled run ID"),
    .init(name: "stepId", kind: .string, description: "Your assigned step ID"),
    .init(name: "status", kind: .string, description: "completed or blocked"),
    .init(
      name: "evidence", kind: .string, description: "Saved work or blocker, up to 4000 characters"),
  ]
  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let status = try arguments.requiredString("status")
    guard ["completed", "blocked"].contains(status) else {
      throw ToolError.invalidArgument("status")
    }
    let result = try await context.relay.reportRunStep(
      workspaceID: context.workspaceID, runID: arguments.requiredString("runId"),
      stepID: arguments.requiredString("stepId"), status: status,
      evidence: arguments.requiredString("evidence"), signingIdentity: context.identity)
    return String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
  }
}

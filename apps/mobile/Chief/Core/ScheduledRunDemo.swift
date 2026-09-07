import Foundation

/// Deterministic content for the existing offline demo and UI regression tests.
enum ScheduledRunDemo {
  static var enabled: Bool { ProcessInfo.processInfo.arguments.contains("--demo-scheduled-run") }
  static var message: ConversationMessage {
    var component = MessageComponent(
      id: "demo-run", kind: "schedule.run",
      payload: [
        "runId": "demo-run", "scheduleId": "demo-schedule", "title": "Create a launch asset",
      ])
    component.payloadArrays["agentIds"] = ["chief", "brand", "content"]
    return ConversationMessage(
      id: "demo-run-thread", workspaceID: DemoWorkspace.snapshot.id,
      conversationID: "mission-control", threadRootID: nil, author: .system,
      body: "Scheduled run: Create a launch asset", components: [component], createdAt: .now,
      sequence: 1000)
  }
  static var reply: ConversationMessage {
    ConversationMessage(
      id: "demo-run-reply", workspaceID: DemoWorkspace.snapshot.id,
      conversationID: "mission-control", threadRootID: message.id,
      author: .agent(id: "brand", name: "Marketer"), body: "The launch draft is saved for review.",
      components: [
        MessageComponent(
          id: "demo-artifact-card", kind: "artifact.reference",
          payload: [
            "fileId": file.id, "conversationId": "mission-control", "title": file.title,
            "mimeType": file.mimeType,
          ])
      ], createdAt: .now, sequence: 1001)
  }
  static var file: WorkspaceFileRecord {
    WorkspaceFileRecord(
      id: "demo-launch-artifact", path: "artifacts/launch.md", title: "Launch draft",
      mimeType: "text/markdown",
      content:
        "# Launch draft\n\nA reusable launch post and demo outline.\n\n## Post\n\nBuild something useful. Show people how it works.\n\n## Demo\n\n1. Show the problem.\n2. Demonstrate the result.\n3. Invite people to try it.",
      conversationId: "mission-control", authorAgentId: "brand", version: 1,
      createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z")
  }
  static var run: WorkspaceScheduleRun {
    WorkspaceScheduleRun(
      id: "demo-run", scheduleId: "demo-schedule", threadRootId: message.id, state: "running",
      schedule: .init(
        agentId: "chief", collaborators: ["brand", "content"], conversationId: "mission-control"),
      steps: [
        .init(
          id: "plan", agentId: "chief", phase: "plan", state: "completed", assignment: nil,
          evidence: "Prepare the launch draft.", error: nil),
        .init(
          id: "write", agentId: "brand", phase: "contribute", state: "running",
          assignment: "Save the launch artifact.", evidence: nil, error: nil),
        .init(
          id: "content", agentId: "content", phase: "contribute", state: "pending",
          assignment: "Review the draft.", evidence: nil, error: nil),
      ], summary: nil)
  }
}

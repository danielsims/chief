import SwiftUI

extension EnvironmentValues {
  @Entry var scheduledRuns: [String: WorkspaceScheduleRun] = [:]
}

struct ScheduledRunTracking: ViewModifier {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase
  let messages: [ConversationMessage]
  let conversationID: String
  @State private var runs: [String: WorkspaceScheduleRun] = [:]

  private var references: [ScheduledRunReference] {
    messages.compactMap(ScheduledRunReference.init)
  }
  private var refreshKey: String {
    ([model.workspace?.id ?? "", conversationID, scenePhase == .active ? "active" : "paused"]
      + references.map { "\($0.scheduleID):\($0.runID)" }.sorted()).joined(separator: "\n")
  }

  func body(content: Content) -> some View {
    content.environment(\.scheduledRuns, runs)
      .task(id: refreshKey) {
        runs = [:]
        guard scenePhase == .active, let workspaceID = model.workspace?.id else { return }
        let wanted = Set(references.map(\.runID))
        let schedules = Set(references.map(\.scheduleID))
        guard !schedules.isEmpty else { return }
        while !Task.isCancelled {
          do {
            var latest: [String: WorkspaceScheduleRun] = [:]
            for scheduleID in schedules {
              let fetched = try await model.relay.scheduleRuns(
                workspaceID: workspaceID, scheduleID: scheduleID)
              for run in fetched
              where wanted.contains(run.id) && run.schedule.conversationId == conversationID {
                latest[run.id] = run
              }
            }
            guard !Task.isCancelled, model.workspace?.id == workspaceID else { return }
            runs = latest
            if !latest.values.contains(where: \.isActive) { return }
            try await Task.sleep(for: .seconds(3))
          } catch {
            guard !Task.isCancelled else { return }
            runs = [:]
            do { try await Task.sleep(for: .seconds(5)) } catch { return }
          }
        }
      }
  }
}

extension WorkspaceScheduleRun {
  static func workingPresences(
    _ runs: [WorkspaceScheduleRun], threadRootID: String? = nil, name: (String) -> String
  ) -> [AgentActivityPresence] {
    var seen = Set<String>()
    return runs.filter { threadRootID == nil || $0.threadRootId == threadRootID }
      .flatMap(\.workingAgentIDs).filter { seen.insert($0).inserted }
      .map { AgentActivityPresence(id: $0, name: name($0)) }
  }
}

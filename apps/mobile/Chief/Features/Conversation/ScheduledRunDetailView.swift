import SwiftUI

struct ScheduledRunDetailView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let reference: ScheduledRunReference
  @State private var run: WorkspaceScheduleRun?
  @State private var error: String?
  @State private var isUpdating = false
  @State private var attempt = 0
  @State private var retryCommandID = UUID().uuidString
  @State private var cancelCommandID = UUID().uuidString

  var body: some View {
    NavigationStack {
      List {
        Section {
          Text(reference.title).font(.headline)
          if let run { Text(run.state.capitalized).foregroundStyle(.secondary) }
        }
        if let run {
          Section("Team progress") {
            ForEach(run.steps) { step in
              VStack(alignment: .leading, spacing: 6) {
                HStack {
                  AgentMark(name: name(step.agentId), size: 24)
                  Text(name(step.agentId))
                  Spacer()
                  if step.state == "running", run.isActive { MatrixLoader(size: 13) }
                  Text(step.state.capitalized).font(.caption).foregroundStyle(.secondary)
                }
                if let assignment = step.assignment { Text(assignment).font(.subheadline) }
                if let evidence = step.evidence {
                  Text(evidence).font(.subheadline).foregroundStyle(.secondary)
                }
                if let error = step.error { Text(error).font(.subheadline).foregroundStyle(.red) }
              }
            }
          }
          if let summary = run.summary { Section("Result") { Text(summary) } }
          Section {
            Button("Open run thread") {
              guard let workspaceID = model.workspace?.id else { return }
              Task {
                await model.handleConversationDeepLink(
                  ConversationDeepLink(
                    workspaceID: workspaceID, conversationID: run.schedule.conversationId,
                    threadRootID: run.threadRootId))
                dismiss()
              }
            }
            if run.isActive {
              Button("Stop run", role: .destructive) { perform("cancel") }.disabled(isUpdating)
            } else if ["failed", "blocked", "cancelled"].contains(run.state) {
              Button("Retry run") { perform("retry") }.disabled(isUpdating)
            }
          }
        } else if error == nil {
          ProgressView()
        }
        if let error {
          Section {
            Text(error).foregroundStyle(.secondary)
            Button("Try again") { attempt += 1 }
          }
        }
      }
      .navigationTitle("Run details").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .task(id: "\(model.workspace?.id ?? ""):\(attempt)") {
        repeat {
          await refresh()
          guard run?.isActive == true, error == nil else { return }
          do { try await Task.sleep(for: .seconds(3)) } catch { return }
        } while !Task.isCancelled
      }
    }
  }

  private func name(_ id: String) -> String {
    model.workspace?.agentDisplayName(id) ?? id.capitalized
  }
  private func refresh() async {
    guard let workspaceID = model.workspace?.id else { return }
    error = nil
    do {
      let runs = try await model.relay.scheduleRuns(
        workspaceID: workspaceID, scheduleID: reference.scheduleID)
      guard !Task.isCancelled, model.workspace?.id == workspaceID else { return }
      run = runs.first { $0.id == reference.runID }
      if run == nil { error = "This run is no longer available." }
    } catch {
      guard !Task.isCancelled else { return }
      self.error = "Could not load this run. Please try again."
    }
  }
  private func perform(_ action: String) {
    guard !isUpdating, let run, let workspaceID = model.workspace?.id else { return }
    isUpdating = true
    error = nil
    Task {
      defer { isUpdating = false }
      do {
        let updated = try await model.relay.scheduleRunAction(
          workspaceID: workspaceID, scheduleID: reference.scheduleID, runID: run.id, action: action,
          commandID: action == "retry" ? retryCommandID : cancelCommandID)
        guard model.workspace?.id == workspaceID else { return }
        if action == "retry" {
          await model.handleConversationDeepLink(
            ConversationDeepLink(
              workspaceID: workspaceID, conversationID: updated.schedule.conversationId,
              threadRootID: updated.threadRootId))
          dismiss()
        } else {
          self.run = updated
        }
      } catch {
        self.error =
          "Could not update this run. Check your connection and workspace permissions, then try again."
      }
    }
  }
}

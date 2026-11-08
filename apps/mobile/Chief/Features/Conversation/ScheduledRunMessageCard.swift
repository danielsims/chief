import SwiftUI

struct ScheduledRunMessageCard: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scheduledRuns) private var runs
  @State private var showsDetails = false
  let reference: ScheduledRunReference
  let replyCount: Int
  var openThread: (() -> Void)?

  private var run: WorkspaceScheduleRun? { runs[reference.runID] }
  private var team: [String] { run?.agentIDs ?? reference.agentIDs }
  private var workers: [String] { run?.workingAgentIDs ?? [] }
  private func name(_ id: String) -> String {
    model.workspace?.agentDisplayName(id) ?? WorkspaceAgentCatalog.agent(forID: id)?.name
      ?? id.capitalized
  }

  var body: some View {
    Group {
      if let openThread {
        Button(action: openThread) { content }
          .buttonStyle(.plain)
          .accessibilityIdentifier("scheduled-run-card")
          .accessibilityLabel("Scheduled run: \(reference.title)")
          .accessibilityHint("Opens the team's work in a thread")
      } else {
        content
      }
    }
    .contextMenu { Button("Run details") { showsDetails = true } }
    .sheet(isPresented: $showsDetails) { ScheduledRunDetailView(reference: reference) }
    .task(id: model.workspace?.id) {
      guard let workspaceID = model.workspace?.id else { return }
      await AutomationCatalogue.shared.load(workspaceID: workspaceID, relay: model.relay)
    }
  }

  /// Desktop's run card: the band says what the run is doing, the card what
  /// it is and who it involves, drawn like an automation step.
  private var content: some View {
    InsetBand {
      Text(run?.isTest == true ? "Test run" : "Scheduled run")
      Spacer(minLength: 4)
      status
      if openThread != nil {
        Image(systemName: "arrow.up.right").font(.system(size: 11)).foregroundStyle(
          ChiefTheme.tertiary)
      }
    } content: {
      VStack(alignment: .leading, spacing: 10) {
        Text(reference.title).font(.system(size: 14, weight: .medium)).foregroundStyle(
          ChiefTheme.accent
        )
        .fixedSize(horizontal: false, vertical: true)
        if !team.isEmpty {
          HStack(spacing: 8) {
            AutomationInvolvedStack(
              lead: team[0], collaborators: Array(team.dropFirst()),
              steps: run?.schedule.automation?.steps ?? [], size: 20)
            Text(team.map(name).joined(separator: ", ")).font(.system(size: 12))
              .foregroundStyle(ChiefTheme.secondary).lineLimit(2)
          }
        }
        if replyCount > 0, openThread != nil {
          Text("\(replyCount) \(replyCount == 1 ? "reply" : "replies")")
            .font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
        }
      }
    }
  }

  @ViewBuilder private var status: some View {
    if !workers.isEmpty {
      MatrixLoader(size: 12).accessibilityHidden(true)
      Text(workers.map(name).joined(separator: ", ") + " working")
        .accessibilityIdentifier("scheduled-run-progress")
    } else if run?.state == "running",
      let step = (run?.schedule.automation?.steps ?? []).walked.first(where: {
        run?.automation?.nodes[$0.id]?.state == "running"
      })
    {
      // A tool step has no agent working, but the run is still busy with it.
      MatrixLoader(size: 12).accessibilityHidden(true)
      Text(step.title)
    } else if run?.state == "queued" {
      Text("Queued")
    } else if run?.state == "failed" || run?.state == "blocked" {
      Text("Failed").foregroundStyle(.red)
    } else if run?.state == "completed" {
      Text("Done")
    }
  }
}

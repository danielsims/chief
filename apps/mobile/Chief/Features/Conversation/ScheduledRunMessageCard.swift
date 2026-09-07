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
  }

  private var content: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Text("Scheduled run").font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
        Spacer(minLength: 4)
        if !workers.isEmpty {
          MatrixLoader(size: 13).foregroundStyle(ChiefTheme.secondary)
            .accessibilityHidden(true)
          Text(workers.map(name).joined(separator: ", ") + " working")
            .font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
            .lineLimit(1)
            .accessibilityIdentifier("scheduled-run-progress")
        } else if run?.state == "queued" {
          Text("Queued").font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
        }
        if openThread != nil {
          Image(systemName: "arrow.up.right").font(.system(size: 11)).foregroundStyle(
            ChiefTheme.tertiary)
        }
      }
      Text(reference.title).font(.system(size: 14, weight: .medium)).foregroundStyle(
        ChiefTheme.accent
      )
      .fixedSize(horizontal: false, vertical: true)
      if !team.isEmpty {
        HStack(spacing: 8) {
          ThreadParticipantStack(
            participants: team.map { .agent(id: $0, name: name($0)) }, replyingAgentID: nil)
          Text(team.map(name).joined(separator: ", ")).font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary).lineLimit(2)
        }
      }
      if replyCount > 0, openThread != nil {
        Text("\(replyCount) \(replyCount == 1 ? "reply" : "replies")")
          .font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
      }
    }
    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
    .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(ChiefTheme.line, lineWidth: 0.5))
  }
}

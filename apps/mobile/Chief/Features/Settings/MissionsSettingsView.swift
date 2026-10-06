import SwiftUI

/// Mission control and the missions agents are running. The operating mode
/// and heartbeat schedule live in the desktop app's local runtime, so iPhone
/// shows the mission channel and the relay's mission records.
struct MissionsSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var missions: [WorkspaceMission]?
  @State private var error: String?

  var body: some View {
    SettingsPage(intro: "Give Chief one room to keep the work moving.") {
      SettingsSection(
        title: "Mission control",
        footer: "Mission control mode and the Chief heartbeat are set in Chief on your Mac."
      ) {
        if let channel = missionChannel {
          Button {
            Haptics.medium()
            model.openConversation(channel.id)
          } label: {
            SettingsDestination(title: "Mission channel", icon: "number", detail: channel.name)
          }
          .buttonStyle(.plain)
        } else {
          SettingsValueRow(title: "Mission channel", value: "Not set up")
        }
      }

      SettingsSection(title: "Missions") {
        if let error {
          SettingsNote(text: error, tone: .failure)
        } else if let missions {
          if missions.isEmpty {
            SettingsEmptyState(
              icon: "scope", title: "No missions yet",
              detail: "Missions your agents start in channels you belong to appear here.")
          } else {
            ForEach(missions) { mission in missionRow(mission) }
          }
        } else {
          SettingsLoading()
        }
      }
    }
    .navigationTitle("Missions")
    .task(id: model.workspace?.id) { await load() }
    .refreshable { await load() }
  }

  private var missionChannel: ConversationSummary? {
    model.workspace?.conversations.first { $0.id == "mission-control" }
  }

  private func missionRow(_ mission: WorkspaceMission) -> some View {
    SettingsRow {
      VStack(alignment: .leading, spacing: 4) {
        Text(mission.title).foregroundStyle(ChiefTheme.accent).lineLimit(1)
        Text(mission.objective)
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(2)
        Text(detail(mission))
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      .padding(.vertical, 8)
      Spacer(minLength: 8)
      SettingsBadge(text: mission.status.capitalized, dot: statusColor(mission.status))
    }
  }

  private func detail(_ mission: WorkspaceMission) -> String {
    var parts = [
      model.workspace?.agentCard(for: mission.ownerAgentId)?.agent.name ?? mission.ownerAgentId,
      "\(mission.experiments.count) of \(mission.maxExperiments) experiments",
    ]
    if let deadline = SettingsFormat.isoDate(mission.deadline) {
      parts.append("due \(SettingsFormat.date(deadline))")
    }
    return parts.joined(separator: " · ")
  }

  private func statusColor(_ status: String) -> Color {
    switch status {
    case "active": .green
    case "paused": .orange
    default: ChiefTheme.tertiary
    }
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    do {
      missions = try await model.relay.workspaceMissions(workspaceID: workspaceID)
      error = nil
    } catch {
      self.error = SettingsFailure.message(error, fallback: "Chief couldn’t load missions.")
    }
  }
}

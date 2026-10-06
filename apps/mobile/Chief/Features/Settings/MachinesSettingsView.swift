import SwiftUI

/// The computers agents can work on. Read-only on iPhone; agent access and
/// capabilities are edited from desktop.
struct MachinesSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var machines: [WorkspaceMachine]?
  @State private var error: String?

  var body: some View {
    SettingsPage(intro: "Computers your agents can work on.") {
      if let error { SettingsNote(text: error, tone: .failure) }
      if let machines {
        if machines.isEmpty {
          SettingsEmptyState(
            icon: "desktopcomputer", title: "No machines connected",
            detail: "Connect a managed computer or one of your own.")
        } else {
          SettingsSection(title: "Machines") {
            ForEach(machines) { machine in machineRow(machine) }
          }
        }
      } else if error == nil {
        SettingsLoading()
      }
    }
    .navigationTitle("Machines")
    .task(id: model.workspace?.id) { await load() }
    .refreshable { await load() }
  }

  private func machineRow(_ machine: WorkspaceMachine) -> some View {
    SettingsRow {
      Image(systemName: machine.kind == "cloudflare" ? "cloud" : "desktopcomputer")
        .font(.system(size: 14))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 34, height: 34)
        .background(
          ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 34 * 0.28, style: .continuous))
      VStack(alignment: .leading, spacing: 3) {
        Text(machine.name).foregroundStyle(ChiefTheme.accent).lineLimit(1)
        Text(summary(machine))
          .font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary).lineLimit(1)
        if !machine.capabilities.isEmpty {
          Text(machine.capabilities.map(\.capitalized).joined(separator: " · "))
            .font(.system(size: 12)).foregroundStyle(ChiefTheme.tertiary).lineLimit(1)
        }
      }
      .padding(.vertical, 6)
      Spacer(minLength: 8)
      SettingsBadge(text: machine.status.capitalized, dot: statusColor(machine.status))
    }
  }

  private func summary(_ machine: WorkspaceMachine) -> String {
    let kind = machine.kind == "cloudflare" ? "Cloudflare Computer" : "Self-hosted"
    let agents =
      switch machine.agentIds.count {
      case 0: "No agents"
      case 1: "1 agent"
      case let count: "\(count) agents"
      }
    return "\(kind) · \(agents)"
  }

  private func statusColor(_ status: String) -> Color {
    switch status {
    case "online": .green
    case "pairing": .orange
    default: ChiefTheme.tertiary
    }
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    do {
      machines = try await model.relay.workspaceMachines(workspaceID: workspaceID)
      error = nil
    } catch {
      self.error = SettingsFailure.message(error, fallback: "Chief couldn’t load machines.")
    }
  }
}

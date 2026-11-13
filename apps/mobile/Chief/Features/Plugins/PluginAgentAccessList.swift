import SwiftUI

struct PluginAccessMember: Identifiable {
  let id: String
  let name: String
  var parentID: String? = nil
}

/// Includes registered local agents even when their device is offline.
func pluginAccessMembers(_ agents: [AgentSummary]) -> [PluginAccessMember] {
  agents.flatMap { parent in
    [PluginAccessMember(id: parent.id, name: parent.name)]
      + parent.subagents.map { PluginAccessMember(id: $0.id, name: $0.name, parentID: parent.id) }
  }
}

/// Parent groups are disclosure only. Each check controls one agent for one plugin.
struct PluginAgentAccessList: View {
  let agents: [AgentSummary]
  let selected: Set<String>
  var editable = true
  var busy: Set<String> = []
  var editableIDs: Set<String>? = nil
  var notes: [String: String] = [:]
  var toggleMany: (([String], Bool) -> Void)? = nil
  let toggle: (String) -> Void
  @State private var collapsed: Set<String> = []

  private var members: [PluginAccessMember] { pluginAccessMembers(agents) }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Agents").font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
      ScrollView {
        VStack(spacing: 0) {
          ForEach(agents) { parent in
            VStack(spacing: 0) {
              agentRow(PluginAccessMember(id: parent.id, name: parent.name), detail: notes[parent.id])
              if !parent.subagents.isEmpty {
                let ids = parent.subagents.map(\.id).filter { editableIDs?.contains($0) ?? true }
                let all = !ids.isEmpty && ids.allSatisfy { selected.contains($0) }
                HStack(spacing: 12) {
                  Button {
                    if collapsed.contains(parent.id) { collapsed.remove(parent.id) } else { collapsed.insert(parent.id) }
                  } label: {
                    HStack(spacing: 8) {
                      Image(systemName: collapsed.contains(parent.id) ? "chevron.right" : "chevron.down")
                      Text("Subagents (\(parent.subagents.count))")
                      Spacer()
                    }
                    .font(.system(size: 12, weight: .medium)).frame(minHeight: 36)
                  }
                  .buttonStyle(.plain).foregroundStyle(ChiefTheme.secondary)
                  .accessibilityLabel("Show \(parent.name) subagents")
                  Button {
                    if let toggleMany { toggleMany(ids, !all) } else { for id in ids where selected.contains(id) == all { toggle(id) } }
                  } label: {
                    Image(systemName: all ? "checkmark.square.fill" : "square")
                      .font(.system(size: 22)).foregroundStyle(all ? ChiefTheme.primary : ChiefTheme.secondary.opacity(0.5))
                  }
                  .buttonStyle(.plain).disabled(!editable || ids.isEmpty)
                  .accessibilityLabel("Select all \(parent.name) subagents")
                  .accessibilityValue(all ? "Enabled" : "Disabled")
                }
                .padding(.horizontal, 12)
              }
              if !collapsed.contains(parent.id) {
                ForEach(members.filter { $0.parentID == parent.id }) { child in
                  SettingsHairline().padding(.leading, 52)
                  agentRow(child, detail: notes[child.id]).padding(.leading, 28)
                }
              }
            }
            if parent.id != agents.last?.id { SettingsHairline() }
          }
        }
      }
      .frame(height: min(320, CGFloat(visibleCount) * 52))
      .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 12))
      .clipShape(RoundedRectangle(cornerRadius: 12))
    }
  }

  private var visibleCount: Int {
    agents.reduce(0) { $0 + 1 + ($1.subagents.isEmpty ? 0 : 1) + (collapsed.contains($1.id) ? 0 : $1.subagents.count) }
  }

  private func agentRow(_ agent: PluginAccessMember, detail: String? = nil) -> some View {
    let on = selected.contains(agent.id)
    return Button { toggle(agent.id) } label: {
      HStack(spacing: 12) {
        AgentMark(name: agent.name, id: agent.id, size: 28)
        VStack(alignment: .leading, spacing: 2) {
          Text(agent.name).font(.system(size: 14, weight: .medium)).lineLimit(1)
          if let detail { Text(detail).font(.system(size: 11)).foregroundStyle(ChiefTheme.secondary) }
        }
        Spacer(minLength: 12)
        if busy.contains(agent.id) {
          ChiefSpinner().controlSize(.small).frame(width: 22, height: 22)
        } else {
          Image(systemName: on ? "checkmark.square.fill" : "square")
            .font(.system(size: 22)).foregroundStyle(on ? ChiefTheme.primary : ChiefTheme.secondary.opacity(0.5))
        }
      }
      .foregroundStyle(ChiefTheme.primary)
      .padding(.horizontal, 12).frame(minHeight: 52).contentShape(Rectangle())
    }
    .buttonStyle(.plain).disabled(!editable || busy.contains(agent.id) || !(editableIDs?.contains(agent.id) ?? true))
    .accessibilityLabel(agent.name).accessibilityValue(on ? "Enabled" : "Disabled")
  }
}

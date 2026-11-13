import SwiftUI

/// A step opened from the flow, read the way desktop's inspector shows it:
/// what it uses, what it's told, and what it did in the latest run.
struct AutomationStepSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let selection: AutomationFlowSelection
  let schedule: WorkspaceSchedule
  let run: WorkspaceScheduleRun?

  private var step: AutomationStep? {
    guard case .step(let id) = selection else { return nil }
    return schedule.steps.walked.first { $0.id == id }
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView {
        VStack(alignment: .leading, spacing: 26) {
          switch selection {
          case .trigger: trigger
          case .brief: brief
          case .step:
            if let step {
              content(for: step)
              if let node = run?.automation?.nodes[step.id], node.state != "pending" {
                lastRun(node, step: step)
              }
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.bottom, 32)
      }
    }
    .chiefSheet([.medium, .large])
  }

  // MARK: Header

  private var header: some View {
    HStack(spacing: 12) {
      icon
        .frame(width: 30, height: 30)
      VStack(alignment: .leading, spacing: 1) {
        if let eyebrow {
          Text(eyebrow).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
        }
        Text(title)
          .font(.system(size: 17, weight: .semibold, design: .rounded))
          .lineLimit(2)
      }
      Spacer(minLength: 8)
      Button("Done") { dismiss() }
        .font(.system(size: 16, weight: .semibold, design: .rounded))
    }
    .foregroundStyle(ChiefTheme.accent)
    .padding(.horizontal, 24)
    .padding(.top, 22)
    .padding(.bottom, 18)
  }

  @ViewBuilder private var icon: some View {
    switch selection {
    case .trigger: symbol("bolt")
    case .brief: symbol("text.alignleft")
    case .step:
      if let step {
        switch step.type {
        case .agent:
          AgentMark(name: name(step.agentId ?? ""), id: step.agentId, size: 30)
        case .tool:
          if step.tool?.source == "plugin" {
            AutomationStepIcon(step: step, size: 30)
          } else {
            ChiefLineMark(size: 17)
              .foregroundStyle(ChiefTheme.onPrimary)
              .frame(width: 30, height: 30)
              .background(ChiefTheme.primary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
          }
        case .condition: symbol("arrow.triangle.branch")
        case .stop: symbol("octagon")
        }
      }
    }
  }

  private func symbol(_ name: String) -> some View {
    Image(systemName: name)
      .font(.system(size: 14, weight: .medium))
      .foregroundStyle(ChiefTheme.secondary)
      .frame(width: 30, height: 30)
      .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
  }

  private var eyebrow: String? {
    guard let step else { return nil }
    switch step.type {
    case .agent: return name(step.agentId ?? "")
    case .tool:
      guard step.tool?.source == "plugin" else { return "Chief" }
      return AutomationCatalogue.shared.plugin(step.tool?.connectionId)?.name ?? step.tool?.connectionId
    case .condition: return "Condition"
    case .stop: return "Stop"
    }
  }

  private var title: String {
    switch selection {
    case .trigger: "Trigger"
    case .brief: "Brief"
    case .step: step?.title ?? "Step"
    }
  }

  // MARK: Trigger and brief

  @ViewBuilder private var trigger: some View {
    let upcoming = (schedule.upcomingRuns ?? [])
      .filter { $0 > Date.now.timeIntervalSince1970 * 1000 }.prefix(3)
    SettingsSection(title: band) {
      Text(schedule.timing).font(.system(size: 15, weight: .medium))
      if schedule.triggerMode != "webhook" {
        Text("\(schedule.timezone.replacingOccurrences(of: "_", with: " ")) time")
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .padding(.top, 3)
      }
    }
    if !upcoming.isEmpty {
      SettingsSection(title: "Upcoming") {
        ForEach(Array(upcoming.enumerated()), id: \.element) { index, at in
          SettingsRow {
            Circle()
              .fill(index == 0 ? ChiefTheme.toggleOn : ChiefTheme.accent.opacity(0.15))
              .frame(width: 6, height: 6)
            Text(
              Date(timeIntervalSince1970: at / 1000)
                .formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
            )
            .monospacedDigit()
            Spacer()
            if index == 0 {
              Text("Next").font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
            }
          }
        }
      }
    } else if schedule.status != "active", schedule.triggerMode != "webhook" {
      SettingsNote(text: "Runs are planned once it’s on.")
    }
  }

  private var band: String {
    if schedule.triggerMode == "webhook" { return "When a webhook arrives" }
    return schedule.onceAt == nil ? "On a schedule" : "Runs once"
  }

  @ViewBuilder private var brief: some View {
    SettingsSection(title: schedule.steps.isEmpty ? "The team works from this" : "Every agent step sees this") {
      Text(schedule.instructions)
        .font(.system(size: 15))
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
    SettingsSection(title: "Team") {
      ForEach(schedule.agentIDs, id: \.self) { id in
        SettingsRow {
          AgentMark(name: name(id), id: id, size: 26)
          Text(name(id))
          Spacer()
          if id == schedule.agentId {
            Text("Lead").font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
          }
        }
      }
    }
  }

  // MARK: Steps

  @ViewBuilder private func content(for step: AutomationStep) -> some View {
    switch step.type {
    case .agent:
      SettingsSection(title: "Instructions") {
        Text(AutomationReferenceText.tokens(step.prompt ?? "", size: 15))
          .font(.system(size: 15))
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
      }
    case .tool: tool(step)
    case .condition:
      if let rule = step.when {
        SettingsSection(title: "If") {
          labelled("This value") { Text(AutomationReferenceText.token(rule.value, size: 15)) }
          labelled("Comparison") { Text(rule.operatorLabel) }
          if rule.comparesValue {
            labelled("Compared with") {
              Text(AutomationReferenceText.token(rule.compare ?? "", size: 15))
            }
          }
        }
      }
    case .stop:
      SettingsSection(title: "The run ends as") {
        Text(step.outcome == "skipped" ? "Nothing to do" : "Done").font(.system(size: 15))
      }
    }
  }

  @ViewBuilder private func tool(_ step: AutomationStep) -> some View {
    let catalogue = AutomationCatalogue.shared
    let reference = step.tool
    let isPlugin = reference?.source == "plugin"
    let plugin = isPlugin ? catalogue.plugin(reference?.connectionId) : nil
    let pluginTool = reference.flatMap { plugin?.tool($0.name) }
    let chiefTool = isPlugin ? nil : reference.flatMap { catalogue.chiefTool($0.name) }
    let readOnly = reference?.readOnly ?? pluginTool?.readOnly ?? chiefTool?.readOnly ?? false
    let description = pluginTool?.description ?? chiefTool?.description
    let missing =
      isPlugin
      ? !catalogue.plugins.isEmpty && pluginTool == nil
      : !catalogue.chiefTools.isEmpty && chiefTool == nil
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        AutomationAccessBadge(readOnly: readOnly)
        Text(readOnly ? "Only reads data" : "Can create, change or send")
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
      }
      if let description, !description.isEmpty {
        Text(description)
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(4)
      }
      if missing {
        SettingsNote(
          text: "This tool isn’t available any more. Reconnect its plugin or delete the step.",
          tone: .failure)
      }
    }
    SettingsSection(title: "Inputs") {
      let arguments = (step.arguments ?? [:]).sorted { $0.key < $1.key }
      if arguments.isEmpty {
        Text("None").font(.system(size: 15)).foregroundStyle(ChiefTheme.secondary)
      }
      ForEach(arguments, id: \.key) { key, value in
        labelled(key) {
          Text(AutomationReferenceText.tokens(value.inlineText, size: 15))
            .lineLimit(8)
        }
      }
    }
  }

  // MARK: Latest run

  /// What this step did last time, or what a test would have sent.
  @ViewBuilder private func lastRun(_ node: AutomationNodeState, step: AutomationStep) -> some View {
    let evidence = node.runStepId.flatMap { id in run?.steps.first { $0.id == id }?.evidence }
    SettingsSection(title: lastRunTitle(node)) {
      VStack(alignment: .leading, spacing: 10) {
        if let duration = duration(node) {
          Text(duration).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
        }
        if node.simulated == true {
          Text("Tests don’t change anything. This is what it would have sent.")
            .font(.system(size: 13))
            .foregroundStyle(ChiefTheme.secondary)
        }
        if let error = node.error {
          Text(error).font(.system(size: 13)).foregroundStyle(.red)
        }
        if node.state == "failed", let input = node.input {
          AutomationJSONBlock(text: input.prettyPrinted)
        }
        if let text = node.output?.agentText ?? (node.output == nil ? evidence : nil) {
          MarkdownMessageBody(source: text, channelNames: [])
            .textSelection(.enabled)
        } else if let output = node.output {
          AutomationJSONBlock(text: output.prettyPrinted + (node.truncated == true ? "\n…" : ""))
        }
      }
    }
  }

  private func lastRunTitle(_ node: AutomationNodeState) -> String {
    if node.simulated == true { return "Would send" }
    switch node.state {
    case "failed": return run?.isTest == true ? "Failed in the test" : "Last run failed"
    case "running": return "Running"
    case "skipped": return "Skipped last run"
    default: return run?.isTest == true ? "Last test" : "Last run"
    }
  }

  private func duration(_ node: AutomationNodeState) -> String? {
    guard let start = node.startedAt else { return nil }
    let started = Date(timeIntervalSince1970: start / 1000)
      .formatted(.dateTime.weekday(.abbreviated).hour().minute())
    guard let end = node.completedAt else { return "Started \(started)" }
    let seconds = Duration.seconds(max(0, (end - start) / 1000))
    return "\(started) · took \(seconds.formatted(.units(allowed: [.minutes, .seconds], width: .narrow)))"
  }

  // MARK: Helpers

  private func labelled(_ label: String, @ViewBuilder value: () -> some View) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(label).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
      value().font(.system(size: 15)).fixedSize(horizontal: false, vertical: true)
    }
    .padding(.vertical, 11)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { SettingsHairline() }
  }

  private func name(_ id: String) -> String {
    model.workspace?.agentDisplayName(id) ?? id.capitalized
  }
}

/// Step input or output, as desktop prints it.
private struct AutomationJSONBlock: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(size: 12, design: .monospaced))
      .textSelection(.enabled)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(ChiefTheme.accent.opacity(0.045), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
  }
}

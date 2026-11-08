import SwiftUI

/// What can be opened on the flow: the trigger, the brief a step-less
/// automation works from, or a step.
enum AutomationFlowSelection: Hashable, Identifiable {
  case trigger
  case brief
  case step(String)

  var id: String {
    switch self {
    case .trigger: "trigger"
    case .brief: "brief"
    case .step(let id): "step:\(id)"
    }
  }
}

/// Desktop's automation canvas for a phone: the trigger and steps top to
/// bottom on a dotted ground, branches indented under their condition, each
/// node marked with how it went in the latest run.
struct AutomationFlowCanvas: View {
  let schedule: WorkspaceSchedule
  let nodes: [String: AutomationNodeState]
  /// The latest run got past its trigger.
  let triggered: Bool
  let name: (String) -> String
  let onSelect: (AutomationFlowSelection) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      AutomationTriggerNode(schedule: schedule, triggered: triggered) { onSelect(.trigger) }
      if schedule.steps.isEmpty {
        FlowStem()
        AutomationBriefNode(schedule: schedule, name: name) { onSelect(.brief) }
        FlowStem()
        FlowPill(text: "End")
      } else {
        FlowStepList(steps: schedule.steps, context: context)
        if schedule.steps.last?.ends == false {
          FlowStem()
          FlowPill(text: "End")
        }
      }
    }
    .padding(12)
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background { DottedGround() }
  }

  private var context: FlowContext {
    FlowContext(nodes: nodes, name: name) { onSelect(.step($0)) }
  }
}

private struct FlowContext {
  let nodes: [String: AutomationNodeState]
  let name: (String) -> String
  let onSelect: (String) -> Void
}

private struct FlowStepList: View {
  let steps: [AutomationStep]
  let context: FlowContext

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(steps) { step in
        FlowStem()
        AutomationStepNode(step: step, node: context.nodes[step.id], name: context.name) {
          context.onSelect(step.id)
        }
        if step.type == .condition { FlowBranches(step: step, context: context) }
      }
    }
  }
}

/// A condition's Yes and No lists, each under its own label, on a rail that
/// ties them to the condition above.
private struct FlowBranches: View {
  let step: AutomationStep
  let context: FlowContext

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      branch("Yes", steps: step.then ?? [])
      branch("No", steps: step.else ?? [])
    }
  }

  private func branch(_ label: String, steps: [AutomationStep]) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      FlowStem()
      HStack(spacing: 8) {
        FlowPill(text: label)
        if steps.isEmpty {
          Text("Carries on").font(.system(size: 11)).foregroundStyle(ChiefTheme.tertiary)
        }
      }
      if !steps.isEmpty {
        FlowStepList(steps: steps, context: context)
          .padding(.leading, 30)
          .overlay(alignment: .topLeading) {
            Rectangle().fill(FlowStem.color).frame(width: 1).padding(.leading, FlowStem.inset)
          }
      }
    }
  }
}

/// The line between two nodes, under their leading edge.
private struct FlowStem: View {
  static let color = ChiefTheme.accent.opacity(0.16)
  static let inset: CGFloat = 22

  var body: some View {
    Rectangle().fill(Self.color).frame(width: 1, height: 16).padding(.leading, Self.inset)
  }
}

private struct FlowPill: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(size: 10, weight: .medium))
      .foregroundStyle(ChiefTheme.secondary)
      .padding(.horizontal, 8)
      .frame(height: 18)
      .background(ChiefTheme.background, in: Capsule())
      .overlay { Capsule().strokeBorder(ChiefTheme.accent.opacity(0.12)) }
      .padding(.leading, FlowStem.inset - 12)
  }
}

/// Desktop's canvas ground: a faint dot every 16 points.
private struct DottedGround: View {
  var body: some View {
    let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
    Canvas { context, size in
      let dot = Path(ellipseIn: CGRect(x: -1, y: -1, width: 2, height: 2))
      var y: CGFloat = 8
      while y < size.height {
        var x: CGFloat = 8
        while x < size.width {
          context.fill(dot.offsetBy(dx: x, dy: y), with: .color(ChiefTheme.accent.opacity(0.12)))
          x += 16
        }
        y += 16
      }
    }
    .background(ChiefTheme.accent.opacity(0.025))
    .clipShape(shape)
    .overlay { shape.strokeBorder(ChiefTheme.accent.opacity(0.06)) }
  }
}

/// One node: its band names the kind of step, its card the step itself.
private struct FlowNode<Title: View, Meta: View>: View {
  let band: String
  var badge: AnyView? = nil
  var state: String?
  let action: () -> Void
  @ViewBuilder let title: Title
  @ViewBuilder let meta: Meta

  var body: some View {
    Button {
      Haptics.light()
      action()
    } label: {
      InsetBand {
        Text(band).frame(maxWidth: .infinity, alignment: .leading)
        badge
      } content: {
        VStack(alignment: .leading, spacing: 5) {
          title
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(ChiefTheme.accent)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
          meta
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
        }
      }
      .opacity(state == "skipped" ? 0.5 : 1)
      .background(ChiefTheme.background, in: InsetShape.band)
      .overlay(alignment: .topTrailing) {
        if let state, state != "pending" { AutomationRunMark(state: state).offset(x: 4, y: -4) }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

private struct AutomationTriggerNode: View {
  let schedule: WorkspaceSchedule
  let triggered: Bool
  let action: () -> Void

  var body: some View {
    FlowNode(band: band, state: triggered ? "completed" : nil, action: action) {
      Text(schedule.timing)
    } meta: {
      if let next = schedule.upcomingRuns?.first(where: { $0 > Date.now.timeIntervalSince1970 * 1000 }) {
        Text("Next \(Date(timeIntervalSince1970: next / 1000).formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()))")
      } else if schedule.triggerMode != "webhook", schedule.onceAt == nil {
        Text(schedule.timezone.replacingOccurrences(of: "_", with: " "))
      }
    }
  }

  private var band: String {
    if schedule.triggerMode == "webhook" { return "When a webhook arrives" }
    return schedule.onceAt == nil ? "On a schedule" : "Runs once"
  }
}

/// A step-less automation runs as its team, from the brief.
private struct AutomationBriefNode: View {
  let schedule: WorkspaceSchedule
  let name: (String) -> String
  let action: () -> Void

  var body: some View {
    FlowNode(band: "Team", action: action) {
      Text(schedule.agentIDs.map(name).joined(separator: ", "))
    } meta: {
      VStack(alignment: .leading, spacing: 8) {
        if !schedule.instructions.isEmpty {
          Text(schedule.instructions).lineLimit(2)
        }
        AutomationInvolvedStack(
          lead: schedule.agentId, collaborators: schedule.collaborators, steps: [], size: 18)
      }
    }
  }
}

private struct AutomationStepNode: View {
  let step: AutomationStep
  let node: AutomationNodeState?
  let name: (String) -> String
  let action: () -> Void

  var body: some View {
    let summary = AutomationStepSummary(step, agentName: name)
    FlowNode(
      band: summary.band,
      badge: summary.readOnly == false ? AnyView(AutomationAccessBadge(readOnly: false)) : nil,
      state: node?.state,
      action: action
    ) {
      HStack(spacing: 6) {
        // Named after its agent: the avatar says who, without repeating it.
        if step.type == .agent, summary.source == nil { AutomationStepIcon(step: step) }
        Text(step.title)
      }
    } meta: {
      VStack(alignment: .leading, spacing: 5) {
        if summary.source != nil || summary.action != nil {
          HStack(spacing: 6) {
            if let source = summary.source {
              AutomationStepIcon(step: step)
              Text(source).foregroundStyle(ChiefTheme.accent.opacity(0.75))
            }
            if summary.source != nil, summary.action != nil {
              Text("•").foregroundStyle(ChiefTheme.tertiary)
            }
            if let action = summary.action { Text(action) }
          }
          .lineLimit(1)
        }
        if step.type == .condition, let rule = step.when {
          Text(conditionText(rule)).lineLimit(2)
        }
        if let detail = summary.detail {
          Text(AutomationReferenceText.tokens(detail)).lineLimit(2)
        }
      }
    }
  }

  private func conditionText(_ rule: AutomationStep.Rule) -> AttributedString {
    var text = AutomationReferenceText.token(rule.value)
    text += AttributedString(" \(rule.operatorLabel) ")
    if rule.comparesValue, let compare = rule.compare, !compare.isEmpty {
      text += AutomationReferenceText.token(compare)
    }
    return text
  }
}

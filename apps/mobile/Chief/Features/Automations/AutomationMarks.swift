import SwiftUI

/// The agents and plugins an automation involves, as one overlapping stack
/// in the order its steps use them (desktop's `AutomationInvolved`).
struct AutomationInvolvedStack: View {
  @Environment(AppModel.self) private var model
  let lead: String
  let collaborators: [String]
  let steps: [AutomationStep]
  var size: CGFloat = 22

  private enum Mark: Identifiable {
    case agent(String)
    case plugin(WorkspacePluginConnection, domain: String)

    var id: String {
      switch self {
      case .agent(let id): "agent:\(id)"
      case .plugin(let plugin, _): "plugin:\(plugin.id)"
      }
    }
  }

  private var marks: [Mark] {
    let catalogue = AutomationCatalogue.shared
    var marks: [Mark] = []
    func add(_ mark: Mark) {
      if !marks.contains(where: { $0.id == mark.id }) { marks.append(mark) }
    }
    for step in steps.walked {
      if step.type == .agent, let agentID = step.agentId { add(.agent(agentID)) }
      if step.type == .tool, step.tool?.source == "plugin",
        let plugin = catalogue.plugin(step.tool?.connectionId), let domain = plugin.domain
      {
        add(.plugin(plugin, domain: domain))
      }
    }
    // An automation without steps runs as its team, from the brief.
    for agentID in [lead] + collaborators { add(.agent(agentID)) }
    return marks
  }

  var body: some View {
    let marks = marks
    HStack(spacing: -4) {
      ForEach(marks.prefix(6)) { mark in
        Group {
          switch mark {
          case .agent(let id):
            AgentMark(name: model.workspace?.agentDisplayName(id) ?? id.capitalized, id: id, size: size)
          case .plugin(let plugin, let domain):
            BrandLogoView(domain: domain, iconURL: plugin.logoURL, size: size)
              .accessibilityLabel(plugin.name)
          }
        }
        .clipShape(Circle())
        .background(ChiefTheme.background, in: Circle())
        .overlay { Circle().stroke(ChiefTheme.background, lineWidth: 2) }
      }
      if marks.count > 6 {
        Text("+\(marks.count - 6)")
          .font(.system(size: size * 0.4, weight: .medium))
          .foregroundStyle(ChiefTheme.secondary)
          .frame(width: size, height: size)
          .background(ChiefTheme.elevated, in: Circle())
          .overlay { Circle().stroke(ChiefTheme.background, lineWidth: 2) }
      }
    }
  }
}

/// Desktop's status pill: a dot and a word.
struct AutomationStatusLabel: View {
  let status: String

  var body: some View {
    HStack(spacing: 5) {
      Circle().fill(color).frame(width: 6, height: 6)
      Text(label)
    }
    .font(.system(size: 12))
    .foregroundStyle(ChiefTheme.secondary)
  }

  private var label: String {
    switch status {
    case "needs_approval": "Review"
    case "draft": "Draft"
    case "active": "Active"
    case "paused": "Paused"
    default: "Issue"
    }
  }

  private var color: Color {
    switch status {
    case "active": ChiefTheme.toggleOn
    case "needs_approval": .orange
    case "error": .red
    default: ChiefTheme.tertiary
    }
  }
}

/// Whether a tool step only reads, or can create, change or send.
struct AutomationAccessBadge: View {
  let readOnly: Bool

  var body: some View {
    Text(readOnly ? "Read" : "Write")
      .font(.system(size: 10, weight: .medium))
      .foregroundStyle(readOnly ? ChiefTheme.secondary : Color.orange)
      .padding(.horizontal, 4)
      .padding(.vertical, 1)
      .background(
        readOnly ? ChiefTheme.accent.opacity(0.05) : Color.orange.opacity(0.12),
        in: RoundedRectangle(cornerRadius: 4, style: .continuous))
  }
}

/// How a step went in the latest run: the corner mark on a canvas node.
struct AutomationRunMark: View {
  let state: String
  @State private var spinning = false

  var body: some View {
    ZStack {
      Circle().fill(color)
      switch state {
      case "running":
        Circle()
          .trim(from: 0, to: 0.7)
          .stroke(.white, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
          .frame(width: 8, height: 8)
          .rotationEffect(.degrees(spinning ? 360 : 0))
          .animation(.linear(duration: 0.8).repeatForever(autoreverses: false), value: spinning)
          .onAppear { spinning = true }
      default:
        Image(systemName: symbol)
          .font(.system(size: 8, weight: .heavy))
          .foregroundStyle(state == "skipped" ? ChiefTheme.background : .white)
      }
    }
    .frame(width: 17, height: 17)
    .overlay { Circle().stroke(ChiefTheme.background, lineWidth: 2) }
    .accessibilityLabel(state.capitalized)
  }

  private var color: Color {
    switch state {
    case "running": .blue
    case "completed": ChiefTheme.toggleOn
    case "failed": .red
    default: ChiefTheme.accent.opacity(0.2)
    }
  }

  private var symbol: String {
    switch state {
    case "completed": "checkmark"
    case "failed": "xmark"
    default: "minus"
    }
  }
}

/// Chief's own mark, drawn as desktop's `ChiefMark`: four corner brackets.
struct ChiefLineMark: View {
  var size: CGFloat = 14

  var body: some View {
    Canvas { context, canvas in
      let s = canvas.width / 64
      var path = Path()
      func corner(_ start: CGPoint, _ turn: CGPoint, _ end: CGPoint) {
        path.move(to: CGPoint(x: start.x * s, y: start.y * s))
        path.addArc(
          tangent1End: CGPoint(x: turn.x * s, y: turn.y * s),
          tangent2End: CGPoint(x: end.x * s, y: end.y * s), radius: 7 * s)
        path.addLine(to: CGPoint(x: end.x * s, y: end.y * s))
      }
      corner(CGPoint(x: 29, y: 12), CGPoint(x: 12, y: 12), CGPoint(x: 12, y: 29))
      corner(CGPoint(x: 35, y: 12), CGPoint(x: 52, y: 12), CGPoint(x: 52, y: 24))
      corner(CGPoint(x: 29, y: 52), CGPoint(x: 12, y: 52), CGPoint(x: 12, y: 35))
      corner(CGPoint(x: 35, y: 52), CGPoint(x: 52, y: 52), CGPoint(x: 52, y: 40))
      context.stroke(path, with: .foreground, style: StrokeStyle(lineWidth: 4.5 * s, lineJoin: .round))
    }
    .frame(width: size, height: size)
    .accessibilityLabel("Chief")
  }
}

/// The logo or avatar a step is drawn with, beside its name.
struct AutomationStepIcon: View {
  @Environment(AppModel.self) private var model
  let step: AutomationStep
  var size: CGFloat = 16

  var body: some View {
    switch step.type {
    case .agent:
      let id = step.agentId ?? ""
      AgentMark(name: model.workspace?.agentDisplayName(id) ?? id.capitalized, id: id, size: size)
        .clipShape(Circle())
    case .tool:
      if step.tool?.source == "plugin" {
        if let plugin = AutomationCatalogue.shared.plugin(step.tool?.connectionId),
          let domain = plugin.domain
        {
          BrandLogoView(domain: domain, iconURL: plugin.logoURL, size: size)
        }
      } else {
        ChiefLineMark(size: size * 0.9)
      }
    case .condition:
      Image(systemName: "arrow.triangle.branch")
        .font(.system(size: size * 0.75))
        .foregroundStyle(ChiefTheme.secondary)
    case .stop:
      Image(systemName: "octagon")
        .font(.system(size: size * 0.75))
        .foregroundStyle(ChiefTheme.secondary)
    }
  }
}

/// What desktop's canvas says about a step: its band, who or what it uses,
/// and what it does.
struct AutomationStepSummary {
  let band: String
  /// The agent, plugin or Chief, unless the title already names it.
  let source: String?
  /// The tool, when the title doesn't already say it.
  let action: String?
  let detail: String?
  let readOnly: Bool?

  @MainActor
  init(_ step: AutomationStep, agentName: (String) -> String) {
    let catalogue = AutomationCatalogue.shared
    switch step.type {
    case .agent:
      let name = agentName(step.agentId ?? "")
      band = "Agent"
      source = step.title == name ? nil : name
      action = nil
      let prompt = step.prompt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      detail = prompt.isEmpty ? "Say what to do" : prompt
      readOnly = nil
    case .condition:
      band = "Condition"
      source = nil
      action = nil
      detail = nil
      readOnly = nil
    case .stop:
      band = "Stop"
      source = nil
      action = step.outcome == "skipped" ? "Nothing to do this time" : "Work done"
      detail = nil
      readOnly = nil
    case .tool:
      let tool = step.tool
      if tool?.source == "plugin" {
        let plugin = catalogue.plugin(tool?.connectionId)
        let name = plugin?.name ?? tool?.connectionId ?? "Plugin"
        let title = tool.flatMap { plugin?.tool($0.name)?.title } ?? tool?.name ?? ""
        readOnly = tool?.readOnly
        band = readOnly == true ? "Read from \(name)" : "Act in \(name)"
        source = name
        action = title == step.title ? nil : title
      } else {
        let chief = tool.flatMap { catalogue.chiefTool($0.name) }
        let label = chief?.label ?? tool?.name ?? ""
        readOnly = chief?.readOnly
        band = readOnly == true ? "Read from Chief" : "Act in Chief"
        source = "Chief"
        action = label == step.title ? nil : label
      }
      detail = nil
    }
  }
}

enum AutomationReferenceText {
  /// `{{steps.meetings.output.count}}` reads as `meetings.count`.
  static func readable(_ reference: String) -> String {
    let inner = reference.trimmingCharacters(in: CharacterSet(charactersIn: "{} "))
    var parts = inner.split(separator: ".").map(String.init)
    if parts.first == "steps", parts.count >= 3, parts[2] == "output" {
      parts = [parts[1]] + parts.dropFirst(3)
    } else if parts.first == "trigger", parts.count >= 2, parts[1] == "input" {
      parts = ["webhook"] + parts.dropFirst(2)
    }
    return parts.joined(separator: ".")
  }

  /// Every `{{reference}}` in `text` in its readable form.
  static func readableReferences(_ text: String) -> String {
    var result = ""
    var rest = Substring(text)
    while let open = rest.range(of: "{{"), let close = rest[open.upperBound...].range(of: "}}") {
      result += rest[..<open.lowerBound] + readable(String(rest[open.lowerBound..<close.upperBound]))
      rest = rest[close.upperBound...]
    }
    return result + rest
  }

  /// A value set apart in monospace, as desktop's `Token`.
  static func token(_ text: String, size: CGFloat = 12) -> AttributedString {
    var token = AttributedString("\u{2009}\(readableReferences(text))\u{2009}")
    token.font = .system(size: size - 1, design: .monospaced)
    token.foregroundColor = ChiefTheme.accent.opacity(0.85)
    token.backgroundColor = ChiefTheme.accent.opacity(0.07)
    return token
  }

  /// Text with each `{{reference}}` shown as a token, as desktop's `WithTokens`.
  static func tokens(_ text: String, size: CGFloat = 12) -> AttributedString {
    var result = AttributedString()
    var rest = Substring(text)
    while let open = rest.range(of: "{{"), let close = rest[open.upperBound...].range(of: "}}") {
      result += AttributedString(String(rest[..<open.lowerBound]))
      result += token(String(rest[open.lowerBound..<close.upperBound]), size: size)
      rest = rest[close.upperBound...]
    }
    return result + AttributedString(String(rest))
  }
}

extension JSONValue {
  /// Pretty JSON, as desktop prints step inputs and outputs.
  var prettyPrinted: String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return (try? encoder.encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
  }

  /// An agent step's output is `{text}`: show the text itself.
  var agentText: String? {
    guard case .object(let object) = self, object.count == 1, case .string(let text)? = object["text"]
    else { return nil }
    return text
  }

  /// A short, readable form for an argument value.
  var inlineText: String {
    switch self {
    case .string(let value): value
    case .number(let value): value.formatted()
    case .bool(let value): value ? "Yes" : "No"
    case .null: "None"
    default: prettyPrinted
    }
  }
}

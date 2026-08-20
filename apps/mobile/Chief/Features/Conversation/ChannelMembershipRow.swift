import SwiftUI

struct ChannelMembershipRow: View {
  let action: MessageComponent
  let createdAt: Date
  let fallbackBody: String

  var body: some View {
    HStack(spacing: 9) {
      if action.payload["actorType"] == "agent" {
        AgentMark(name: actorName, size: 22)
      } else {
        RoundedRectangle(cornerRadius: 6)
          .fill(ChiefTheme.elevated)
          .frame(width: 22, height: 22)
          .overlay {
            Text(actorName.prefix(1).uppercased())
              .font(.system(size: 9, weight: .semibold))
          }
      }
      Text(summary)
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.secondary)
      Text(createdAt, style: .time)
        .font(.system(size: 11))
        .foregroundStyle(ChiefTheme.tertiary)
      Spacer(minLength: 0)
    }
    .padding(.vertical, 6)
    .padding(.leading, 45)
    .accessibilityElement(children: .combine)
  }

  private var actorName: String {
    action.payload["actorName"] ?? "Chief"
  }

  private var summary: AttributedString {
    let target = targetNames.isEmpty
      ? (action.payload["targetName"] ?? "a member")
      : Self.formattedList(targetNames)
    var result = AttributedString("\(actorName) added \(target) to the channel")
    result.foregroundColor = ChiefTheme.secondary
    if let actorRange = result.range(of: actorName) {
      result[actorRange].font = .system(size: 12, weight: .semibold)
      result[actorRange].foregroundColor = ChiefTheme.accent
    }
    if let targetRange = result.range(of: target, options: .backwards) {
      result[targetRange].font = .system(size: 12, weight: .semibold)
      result[targetRange].foregroundColor = ChiefTheme.accent
    }
    return result
  }

  private var targetNames: [String] {
    action.payload["targetNames"]?
      .split(separator: ",")
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty } ?? []
  }

  private static func formattedList(_ values: [String]) -> String {
    switch values.count {
    case 0: "a member"
    case 1: values[0]
    case 2: "\(values[0]) and \(values[1])"
    default: "\(values.dropLast().joined(separator: ", ")), and \(values.last!)"
    }
  }
}

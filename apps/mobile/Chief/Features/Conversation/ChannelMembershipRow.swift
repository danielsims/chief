import SwiftUI

struct ChannelMembershipRow: View {
  @Environment(AppModel.self) private var model
  let action: MessageComponent
  let createdAt: Date
  let fallbackBody: String

  var body: some View {
    HStack(spacing: 9) {
      if action.payload["actorType"] == "agent" {
        AgentMark(name: actorName, size: 22)
      } else {
        UserAvatar(user: actorUser, size: 22)
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

  private var actorUser: ChiefUser {
    if let user = model.session?.user, action.payload["actorId"] == user.id {
      return user
    }
    return ChiefUser(id: action.payload["actorId"] ?? "member",
      name: actorName == "You" ? "Member" : actorName, imageURL: nil)
  }

  private var actorName: String {
    if action.payload["actorId"] == model.session?.user.id { return "You" }
    let name = action.payload["actorName"] ?? "Chief"
    return name == "You" ? "A member" : name
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

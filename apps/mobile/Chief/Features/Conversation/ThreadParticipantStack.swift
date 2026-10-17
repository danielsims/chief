import SwiftUI

enum ThreadParticipant: Identifiable, Equatable {
  case agent(id: String, name: String)
  case user(id: String, name: String)

  var id: String {
    switch self {
    case .agent(let id, _), .user(let id, _): id
    }
  }

  var name: String {
    switch self {
    case .agent(_, let name), .user(_, let name): name
    }
  }
}

struct ThreadParticipantStack: View {
  @Environment(AppModel.self) private var model
  let participants: [ThreadParticipant]
  let replyingAgentID: String?

  var body: some View {
    HStack(spacing: -5) {
      ForEach(participants.prefix(3)) { participant in
        participantView(participant)
          .frame(width: 22, height: 22)
          .background(ChiefTheme.background, in: RoundedRectangle(cornerRadius: 6))
          .overlay {
            RoundedRectangle(cornerRadius: 6)
              .stroke(ChiefTheme.background, lineWidth: 2)
          }
      }
      if participants.count > 3 {
        Text("+\(participants.count - 3)")
          .font(.system(size: 7, weight: .semibold))
          .frame(width: 22, height: 22)
          .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 6))
          .overlay {
            RoundedRectangle(cornerRadius: 6)
              .stroke(ChiefTheme.background, lineWidth: 2)
          }
      }
    }
    .frame(minWidth: 22, alignment: .leading)
  }

  @ViewBuilder
  private func participantView(_ participant: ThreadParticipant) -> some View {
    switch participant {
    case .agent(let id, let name):
      if id == replyingAgentID {
        MatrixLoader(size: 15)
          .foregroundStyle(ChiefTheme.agentColor(id))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        AgentMark(name: name, size: 20)
      }
    case .user(let id, let name):
      UserAvatar(user: model.person(userID: id, fallbackName: name), size: 20, rounded: true)
    }
  }
}

@MainActor extension RelativeDateTimeFormatter {
  static let threadActivity: RelativeDateTimeFormatter = {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter
  }()
}

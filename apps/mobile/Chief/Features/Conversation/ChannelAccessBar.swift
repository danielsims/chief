import SwiftUI

/// Replaces every write surface while a channel is being previewed or has
/// been archived. Public messages remain readable; participation is unlocked
/// only after the relay accepts a membership join.
struct ChannelAccessBar: View {
  let channelName: String
  let isMember: Bool
  let isPrivate: Bool
  let isArchived: Bool
  let isJoining: Bool
  let error: String?
  let onJoin: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        if !isPrivate {
          Image(systemName: icon)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(ChiefTheme.secondary)
            .frame(width: 34, height: 34)
            .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10))
        }

        VStack(alignment: .leading, spacing: 2) {
          Text(title)
            .font(.system(size: 14, weight: .semibold))
          Text(detail)
            .font(.system(size: 12.5))
            .foregroundStyle(ChiefTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }

        Spacer(minLength: 4)

        if canJoin {
          Button(action: onJoin) {
            Group {
              if isJoining {
                ProgressView().controlSize(.small)
              } else {
                Text("Join")
                  .font(.system(size: 13, weight: .semibold))
              }
            }
            .frame(minWidth: 54, minHeight: 34)
            .foregroundStyle(Color(uiColor: .systemBackground))
            .background(Color(uiColor: .label), in: Capsule())
          }
          .buttonStyle(.plain)
          .disabled(isJoining)
          .accessibilityLabel("Join #\(channelName)")
        }
      }

      if let error {
        Text(error)
          .font(.system(size: 12))
          .foregroundStyle(Color(uiColor: .systemRed))
          .padding(.leading, isPrivate ? 0 : 46)
      }
    }
    .padding(.horizontal, ChiefTheme.pagePadding)
    .padding(.vertical, 11)
    .background(ChiefTheme.surface)
    .overlay(alignment: .top) {
      Rectangle().fill(ChiefTheme.line.opacity(0.65)).frame(height: 0.5)
    }
  }

  private var canJoin: Bool {
    !isMember && !isPrivate && !isArchived
  }

  private var icon: String {
    if isArchived { return "archivebox" }
    if isPrivate { return "lock" }
    return "eye"
  }

  private var title: String {
    if isArchived { return "This channel is archived" }
    if isPrivate { return "Invitation required" }
    return "Viewing #\(channelName)"
  }

  private var detail: String {
    if isArchived { return "Messages are available to read, but this channel is closed." }
    if isPrivate { return "A channel member needs to invite you before you can participate." }
    return "Join to send messages and receive notifications."
  }
}

struct ChannelAccessLoadingBar: View {
  var body: some View {
    HStack(spacing: 10) {
      ProgressView().controlSize(.small)
      Text("Checking channel access…")
        .font(.system(size: 12.5))
        .foregroundStyle(ChiefTheme.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .center)
    .padding(.horizontal, ChiefTheme.pagePadding)
    .padding(.vertical, 15)
    .background(ChiefTheme.surface)
  }
}

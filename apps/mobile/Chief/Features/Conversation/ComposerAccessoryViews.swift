import SwiftUI

struct ComposerAttachmentStrip: View {
  let attachments: [ComposerAttachment]
  let onRemove: (ComposerAttachment) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(attachments) { attachment in
          attachmentPreview(attachment)
        }
      }
      .padding(.horizontal, 12)
      .padding(.top, 8)
    }
  }

  private func attachmentPreview(_ attachment: ComposerAttachment) -> some View {
    ZStack(alignment: .topTrailing) {
      Group {
        if let image = attachment.previewImage {
          Image(uiImage: image).resizable().scaledToFill()
        } else {
          Rectangle().fill(ChiefTheme.elevated).overlay {
            Image(systemName: "photo").foregroundStyle(ChiefTheme.secondary)
          }
        }
      }
      .frame(width: 68, height: 68)
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(ChiefTheme.line)
      }

      Button {
        Haptics.medium()
        onRemove(attachment)
      } label: {
        Image(systemName: "xmark")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(.white)
          .frame(width: 20, height: 20)
          .background(.black.opacity(0.72), in: Circle())
      }
      .buttonStyle(.plain)
      .offset(x: 5, y: -5)
      .accessibilityLabel("Remove \(attachment.fileName)")
    }
  }
}

struct MentionPicker: View {
  let agents: [MentionAgent]
  let onSelect: (MentionAgent) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(agents) { agent in
          Button {
            Haptics.selection()
            onSelect(agent)
          } label: {
            HStack(spacing: 7) {
              AgentMark(name: agent.name, size: 24)
              Text(agent.name).font(.system(size: 14, weight: .medium))
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(ChiefTheme.surface, in: Capsule())
            .overlay { Capsule().stroke(ChiefTheme.line) }
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
    }
    .background(ChiefTheme.background)
  }
}

struct ComposerSkillPicker: View {
  let onSelect: (MessageSkill) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(MessageSkillCatalog.skills) { skill in
          Button {
            Haptics.medium()
            onSelect(skill)
          } label: {
            Label(skill.label, systemImage: "book.closed")
              .font(.system(size: 13, weight: .medium))
              .padding(.horizontal, 12)
              .frame(height: 38)
              .background(ChiefTheme.surface, in: Capsule())
              .overlay { Capsule().stroke(ChiefTheme.line) }
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
    }
    .background(ChiefTheme.background)
  }
}

struct ComposerEmojiPicker: View {
  let onSelect: (String) -> Void

  var body: some View {
    VStack(spacing: 12) {
      Text("Add an emoji")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
      LazyVGrid(
        columns: Array(repeating: GridItem(.flexible()), count: 8),
        spacing: 10
      ) {
        ForEach(ChiefEmojiCatalog.all, id: \.self) { emoji in
          Button {
            Haptics.medium()
            onSelect(emoji)
          } label: {
            Text(emoji).font(.system(size: 22))
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.horizontal, 8)
    }
    .padding(16)
    .presentationCompactAdaptation(.popover)
  }
}

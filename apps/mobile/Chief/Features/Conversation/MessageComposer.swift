import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ComposerAttachment: Identifiable {
  let id = UUID().uuidString
  let fileName: String
  let data: Data

  var previewImage: UIImage? { UIImage(data: data) }
}

struct MessageComposer: View {
  @Binding var text: String
  @Binding var mentionIDs: [String]
  @Binding var skillIDs: [String]
  let isSending: Bool
  let attachments: [ComposerAttachment]
  let onSend: () -> Void
  let onAddAttachments: ([ComposerAttachment]) -> Void
  let onRemoveAttachment: (ComposerAttachment) -> Void

  @FocusState private var isFocused: Bool
  @State private var mentionQuery = ""
  @State private var showsMentions = false
  @State private var showsSkills = false
  @State private var showsEmojiPicker = false
  @State private var showsAttachmentChoices = false
  @State private var showsPhotoPicker = false
  @State private var showsFileImporter = false
  @State private var photoItems: [PhotosPickerItem] = []

  private static let maximumAttachmentCount = 4
  private static let maximumAttachmentBytes = 8 * 1_024 * 1_024

  var body: some View {
    VStack(spacing: 7) {
      if showsMentions { MentionPicker(agents: mentionCandidates, onSelect: insertMention) }
      if showsSkills { ComposerSkillPicker(onSelect: insertSkill) }
      composerSurface
    }
    .background(ChiefTheme.background)
    .photosPicker(
      isPresented: $showsPhotoPicker,
      selection: $photoItems,
      maxSelectionCount: remainingAttachmentCount,
      matching: .images
    )
    .onChange(of: photoItems) { _, items in loadPhotos(items) }
    .confirmationDialog("Add attachment", isPresented: $showsAttachmentChoices) {
      Button("Photo Library") { showsPhotoPicker = true }
      Button("Choose Image File") { showsFileImporter = true }
      Button("Cancel", role: .cancel) {}
    }
    .fileImporter(
      isPresented: $showsFileImporter,
      allowedContentTypes: [.image],
      allowsMultipleSelection: true,
      onCompletion: loadFiles
    )
    .popover(isPresented: $showsEmojiPicker) {
      ComposerEmojiPicker { emoji in
        text.append(emoji)
        showsEmojiPicker = false
      }
    }
    .simultaneousGesture(
      DragGesture(minimumDistance: 12).onChanged { value in
        guard value.translation.height > 10 else { return }
        KeyboardDismissal.dismiss()
      }
    )
  }

  private var composerSurface: some View {
    VStack(spacing: 0) {
      if !mentionIDs.isEmpty || !skillIDs.isEmpty { referenceStrip }
      if !attachments.isEmpty {
        ComposerAttachmentStrip(
          attachments: attachments,
          onRemove: onRemoveAttachment
        )
      }
      TextField("Ask anything…", text: $text, axis: .vertical)
        .font(.system(size: 16))
        .lineLimit(2...7)
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
        .frame(minHeight: 66, alignment: .top)
        .focused($isFocused)
        .onChange(of: text) { _, value in updateMentionState(value) }

      HStack(spacing: 2) {
        ComposerIconButton(systemImage: "at", label: "Mention an agent") {
          Haptics.medium()
          mentionQuery = ""
          showsSkills = false
          showsMentions = true
          isFocused = true
        }

        ComposerIconButton(systemImage: "book.closed", label: "Add a skill") {
          Haptics.medium()
          showsMentions = false
          showsSkills.toggle()
          isFocused = true
        }

        ComposerIconButton(systemImage: "paperclip", label: "Add attachment") {
          Haptics.medium()
          showsAttachmentChoices = true
        }
        .disabled(remainingAttachmentCount == 0)

        ComposerIconButton(systemImage: "face.smiling", label: "Add emoji") {
          Haptics.medium()
          showsEmojiPicker = true
        }

        Spacer(minLength: 0)

        Button {
          Haptics.medium()
          onSend()
        } label: {
          Group {
            if isSending { ProgressView() } else { Image(systemName: "arrow.up") }
          }
          .font(.system(size: 15, weight: .bold))
          .frame(width: 36, height: 36)
          .background(canSend ? Color.white : ChiefTheme.elevated, in: Circle())
          .foregroundStyle(canSend ? Color.black : ChiefTheme.tertiary)
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .accessibilityLabel("Send message")
      }
      .padding(.horizontal, 8)
      .padding(.bottom, 7)
    }
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 24, style: .continuous)
        .stroke(ChiefTheme.line)
    }
    .shadow(color: .black.opacity(0.22), radius: 16, y: 6)
    .padding(.horizontal, 10)
    .padding(.top, 8)
    .padding(.bottom, 7)
  }

  private var referenceStrip: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(mentionIDs, id: \.self) { id in
          if let agent = WorkspaceAgentCatalog.agent(forID: id) {
            ComposerReferenceChip(
              symbol: "at",
              label: agent.name,
              remove: { mentionIDs.removeAll { $0 == id } }
            )
          }
        }
        ForEach(skillIDs, id: \.self) { id in
          ComposerReferenceChip(
            symbol: "book.closed",
            label: MessageSkillCatalog.skill(forID: id).label,
            remove: { skillIDs.removeAll { $0 == id } }
          )
        }
      }
      .padding(.horizontal, 12)
      .padding(.top, 10)
    }
  }

  private var canSend: Bool {
    (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      || !attachments.isEmpty || !mentionIDs.isEmpty || !skillIDs.isEmpty)
      && !isSending
  }

  private var remainingAttachmentCount: Int {
    max(0, Self.maximumAttachmentCount - attachments.count)
  }

  private var mentionCandidates: [MentionAgent] {
    WorkspaceAgentCatalog.matching(prefix: mentionQuery)
  }

  private func loadPhotos(_ items: [PhotosPickerItem]) {
    guard !items.isEmpty else { return }
    Task {
      var loaded: [ComposerAttachment] = []
      for item in items.prefix(remainingAttachmentCount) {
        guard let data = try? await item.loadTransferable(type: Data.self),
          data.count <= Self.maximumAttachmentBytes,
          UIImage(data: data) != nil
        else { continue }
        let fileExtension = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
        loaded.append(
          ComposerAttachment(
            fileName: "photo-\(UUID().uuidString.prefix(8)).\(fileExtension)",
            data: data
          )
        )
      }
      photoItems = []
      if !loaded.isEmpty { onAddAttachments(loaded) }
    }
  }

  private func loadFiles(_ result: Result<[URL], Error>) {
    guard case .success(let urls) = result else { return }
    let selectedURLs = Array(urls.prefix(remainingAttachmentCount))
    let maximumAttachmentBytes = Self.maximumAttachmentBytes
    Task {
      let loaded = await Task.detached(priority: .userInitiated) {
        selectedURLs.compactMap { url -> ComposerAttachment? in
          let hasAccess = url.startAccessingSecurityScopedResource()
          defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
          guard let data = try? Data(contentsOf: url),
            data.count <= maximumAttachmentBytes,
            UIImage(data: data) != nil
          else { return nil }
          return ComposerAttachment(fileName: url.lastPathComponent, data: data)
        }
      }.value
      if !loaded.isEmpty { onAddAttachments(loaded) }
    }
  }

  private func updateMentionState(_ value: String) {
    guard let token = trailingMentionToken(in: value) else {
      mentionQuery = ""
      showsMentions = false
      return
    }
    mentionQuery = token
    showsMentions = true
  }

  private func insertMention(_ agent: MentionAgent) {
    if let atIndex = trailingMentionIndex(in: text) {
      text = String(text[..<atIndex])
    }
    if !mentionIDs.contains(agent.id) { mentionIDs.append(agent.id) }
    mentionQuery = ""
    showsMentions = false
    isFocused = true
  }

  private func insertSkill(_ skill: MessageSkill) {
    if !skillIDs.contains(skill.id) { skillIDs.append(skill.id) }
    showsSkills = false
    isFocused = true
  }

  private func trailingMentionToken(in value: String) -> String? {
    guard let index = trailingMentionIndex(in: value) else { return nil }
    return String(value[value.index(after: index)...])
  }

  private func trailingMentionIndex(in value: String) -> String.Index? {
    let tokenStart =
      value.lastIndex(where: { $0.isWhitespace })
      .map { value.index(after: $0) } ?? value.startIndex
    guard tokenStart < value.endIndex, value[tokenStart] == "@" else { return nil }
    return tokenStart
  }
}

enum KeyboardDismissal {
  @MainActor static func dismiss() {
    UIApplication.shared.sendAction(
      #selector(UIResponder.resignFirstResponder),
      to: nil,
      from: nil,
      for: nil
    )
  }
}

private struct ComposerIconButton: View {
  let systemImage: String
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.system(size: 17, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 38, height: 42)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

private struct ComposerAttachmentStrip: View {
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

private struct MentionPicker: View {
  let agents: [MentionAgent]
  let onSelect: (MentionAgent) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(agents) { agent in
          Button {
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

private struct ComposerSkillPicker: View {
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

private struct ComposerReferenceChip: View {
  let symbol: String
  let label: String
  let remove: () -> Void

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: symbol)
        .font(.system(size: 10, weight: .semibold))
      Text(label)
        .font(.system(size: 12, weight: .semibold))
      Button {
        Haptics.medium()
        remove()
      } label: {
        Image(systemName: "xmark")
          .font(.system(size: 8, weight: .bold))
          .frame(width: 16, height: 16)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Remove \(label)")
    }
    .foregroundStyle(ChiefTheme.accent)
    .padding(.leading, 9)
    .padding(.trailing, 5)
    .frame(height: 28)
    .background(ChiefTheme.accent.opacity(0.065), in: RoundedRectangle(cornerRadius: 7))
    .overlay {
      RoundedRectangle(cornerRadius: 7).stroke(ChiefTheme.accent.opacity(0.12))
    }
  }
}

private struct ComposerEmojiPicker: View {
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

enum MessageAttachmentUploader {
  static func components(
    for attachments: [ComposerAttachment],
    workspaceID: String,
    conversationID: String,
    relay: any RelayServing
  ) async throws -> [MessageComponent] {
    var components: [MessageComponent] = []
    for attachment in attachments {
      let url = try await relay.uploadAttachment(
        workspaceID: workspaceID,
        conversationID: conversationID,
        fileName: attachment.fileName,
        data: attachment.data
      )
      var payload = [
        "name": attachment.fileName,
        "mediaType": mediaType(for: attachment.fileName),
        "url": url,
      ]
      if let thumbnail = attachment.previewImage?.jpegData(compressionQuality: 0.85) {
        payload["thumbnail"] = thumbnail.base64EncodedString()
      }
      components.append(
        MessageComponent(id: UUID().uuidString, kind: "attachment", payload: payload)
      )
    }
    return components
  }

  private static func mediaType(for fileName: String) -> String {
    guard let type = UTType(filenameExtension: URL(fileURLWithPath: fileName).pathExtension),
      let mimeType = type.preferredMIMEType
    else { return "application/octet-stream" }
    return mimeType
  }
}

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
  var availableMentionAgentIDs: [String] = WorkspaceAgentCatalog.agents.map(\.id)
  var preferredMentionAgentIDs: [String] = []
  var people: [MentionAgent] = []
  let onSend: () -> Void
  let onAddAttachments: ([ComposerAttachment]) -> Void
  let onRemoveAttachment: (ComposerAttachment) -> Void

  @State private var isFocused = false
  @State private var editorSelection = NSRange(location: 0, length: 0)
  @State private var editorHeight: CGFloat = 48
  @State private var mentionQuery = ""
  @State private var showsMentions = false
  @State private var mentionPickerWasRequested = false
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
        insertAtCursor(emoji)
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
      if !attachments.isEmpty {
        ComposerAttachmentStrip(
          attachments: attachments,
          onRemove: onRemoveAttachment
        )
      }
      ZStack(alignment: .topLeading) {
        ComposerTextView(
          text: $text,
          selection: $editorSelection,
          isFocused: $isFocused,
          height: $editorHeight
        )
        if text.isEmpty {
          Text("Ask anything…")
            .font(.system(size: 16))
            .foregroundStyle(ChiefTheme.tertiary)
            .padding(.leading, 12)
            .padding(.top, ComposerTextView.topInset + 1)
            .allowsHitTesting(false)
        }
      }
      .frame(maxWidth: .infinity)
      .frame(height: editorHeight)
      .clipped()
      .onChange(of: text) { _, value in
        if value.isEmpty { editorHeight = 48 }
        synchronizeReferences(in: value)
        updateMentionState()
      }
      .onChange(of: editorSelection) { _, _ in updateMentionState() }

      HStack(spacing: 2) {
        ComposerIconButton(systemImage: "at", label: "Mention an agent") {
          Haptics.medium()
          let shouldOpen = !showsMentions
          mentionQuery = ""
          mentionPickerWasRequested = shouldOpen
          showsSkills = false
          showsMentions = shouldOpen
          if shouldOpen { isFocused = true }
        }

        ComposerIconButton(systemImage: "book.closed", label: "Add a skill") {
          Haptics.medium()
          let shouldOpen = !showsSkills
          mentionPickerWasRequested = false
          showsMentions = false
          showsSkills = shouldOpen
          if shouldOpen { isFocused = true }
        }

        ComposerIconButton(systemImage: "paperclip", label: "Add attachment") {
          Haptics.medium()
          showsAttachmentChoices = true
        }
        .disabled(remainingAttachmentCount == 0)

        ComposerIconButton(systemImage: "face.smiling", label: "Add emoji") {
          Haptics.medium()
          showsEmojiPicker.toggle()
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

  private var canSend: Bool {
    (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      || !attachments.isEmpty || !mentionIDs.isEmpty || !skillIDs.isEmpty)
      && !isSending
  }

  private var remainingAttachmentCount: Int {
    max(0, Self.maximumAttachmentCount - attachments.count)
  }

  private var mentionCandidates: [MentionAgent] {
    let available = Set(availableMentionAgentIDs + people.map(\.id))
    let preferredOrder = Dictionary(
      uniqueKeysWithValues: preferredMentionAgentIDs.enumerated().map { ($0.element, $0.offset) }
    )
    let catalogOrder = Dictionary(
      uniqueKeysWithValues: WorkspaceAgentCatalog.agents.enumerated().map { ($0.element.id, $0.offset) }
    )
    return WorkspaceAgentCatalog.matching(prefix: mentionQuery, people: people).filter { $0.role != "You" }
      .filter { available.contains($0.id) }
      .sorted { left, right in
      let leftPreferred = preferredOrder[left.id]
      let rightPreferred = preferredOrder[right.id]
      if leftPreferred != nil || rightPreferred != nil {
        if leftPreferred == nil { return false }
        if rightPreferred == nil { return true }
        return leftPreferred! < rightPreferred!
      }
      return (catalogOrder[left.id] ?? .max) < (catalogOrder[right.id] ?? .max)
      }
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

  private func updateMentionState() {
    guard let active = activeMention(in: text, selection: editorSelection) else {
      mentionQuery = ""
      if !mentionPickerWasRequested { showsMentions = false }
      return
    }
    mentionPickerWasRequested = false
    mentionQuery = active.query
    showsMentions = true
  }

  private func insertMention(_ agent: MentionAgent) {
    let replacementRange = activeMention(in: text, selection: editorSelection)?.range
      ?? editorSelection
    insertReference("@\(agent.name)", replacing: replacementRange)
    mentionQuery = ""
    mentionPickerWasRequested = false
    showsMentions = false
    isFocused = true
  }

  private func insertSkill(_ skill: MessageSkill) {
    insertReference("[chief-skill:\(skill.id)]", replacing: editorSelection)
    showsSkills = false
    isFocused = true
  }

  private func synchronizeReferences(in value: String) {
    let mentions = AgentMentionParser.mentions(in: value, people: people)
    let skills = MessageReferenceParser.skillIDs(in: value)
    if mentionIDs != mentions { mentionIDs = mentions }
    if skillIDs != skills { skillIDs = skills }
  }

  private func activeMention(
    in value: String,
    selection: NSRange
  ) -> (query: String, range: NSRange)? {
    let source = value as NSString
    guard selection.length == 0, selection.location <= source.length else { return nil }
    let prefixRange = NSRange(location: 0, length: selection.location)
    let whitespace = source.rangeOfCharacter(
      from: .whitespacesAndNewlines,
      options: .backwards,
      range: prefixRange
    )
    let start = whitespace.location == NSNotFound ? 0 : NSMaxRange(whitespace)
    let candidateRange = NSRange(location: start, length: selection.location - start)
    let candidate = source.substring(with: candidateRange)
    guard candidate.hasPrefix("@"), !candidate.dropFirst().contains(where: { $0.isWhitespace })
    else { return nil }
    return (String(candidate.dropFirst()), candidateRange)
  }

  private func insertAtCursor(_ value: String) {
    replace(editorSelection, with: value)
  }

  private func insertReference(_ token: String, replacing range: NSRange) {
    let source = text as NSString
    let safeRange = clamped(range, to: source.length)
    var insertion = token
    if safeRange.location > 0 {
      let previous = source.substring(with: NSRange(location: safeRange.location - 1, length: 1))
      if previous.rangeOfCharacter(from: .whitespacesAndNewlines) == nil {
        insertion = " " + insertion
      }
    }
    if NSMaxRange(safeRange) < source.length {
      let next = source.substring(with: NSRange(location: NSMaxRange(safeRange), length: 1))
      if next.rangeOfCharacter(from: .whitespacesAndNewlines) == nil {
        insertion += " "
      }
    } else {
      insertion += " "
    }
    replace(safeRange, with: insertion)
  }

  private func replace(_ range: NSRange, with replacement: String) {
    let source = text as NSString
    let safeRange = clamped(range, to: source.length)
    text = source.replacingCharacters(in: safeRange, with: replacement)
    editorSelection = NSRange(
      location: safeRange.location + (replacement as NSString).length,
      length: 0
    )
  }

  private func clamped(_ range: NSRange, to length: Int) -> NSRange {
    let location = min(max(0, range.location), length)
    return NSRange(location: location, length: min(max(0, range.length), length - location))
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

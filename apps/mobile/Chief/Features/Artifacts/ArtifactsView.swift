import QuickLook
import SwiftUI
import UniformTypeIdentifiers

/// Everything the team has made, from every channel this device can read.
/// Text artifacts open as Canvas shows them; uploaded media opens in Quick Look.
struct ArtifactsView: View {
  @Environment(AppModel.self) private var model
  @State private var files: [WorkspaceFileRecord] = []
  @State private var search = ""
  @State private var kind: String?
  @State private var loading = true
  @State private var error: String?
  @State private var openingFileID: String?
  @State private var preview: URL?
  @State private var openError: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 12) {
        Text("Artifacts")
          .font(.system(size: 26, weight: .regular, design: .rounded))
          .tracking(-0.6)
          .frame(height: 34)
        Spacer(minLength: 0)
        if kindOptions.count > 2 {
          ChiefModePicker(selection: $kind, options: kindOptions)
        }
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 16)
      ChiefSearchField(prompt: "Search artifacts", text: $search)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if loading && files.isEmpty {
            ChiefSpinner()
              .tint(ChiefTheme.accent)
              .frame(maxWidth: .infinity)
              .padding(.top, 36)
          } else if let error, files.isEmpty {
            ContentUnavailableView {
              Label("Artifacts unavailable", systemImage: "wifi.slash")
            } description: {
              Text(error)
            } actions: {
              Button("Try again") { Task { await load() } }
            }
            .foregroundStyle(ChiefTheme.secondary)
          } else if files.isEmpty {
            ContentUnavailableView(
              "Nothing made yet", systemImage: "folder",
              description: Text("Pages and documents your team makes appear here."))
            .foregroundStyle(ChiefTheme.secondary)
          } else if filteredFiles.isEmpty {
            ContentUnavailableView.search(text: search)
              .foregroundStyle(ChiefTheme.secondary)
          } else {
            ForEach(filteredFiles) { file in row(file) }
          }
        }
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.bottom, ChiefTheme.pagePadding)
      }
      .refreshable { await load() }
    }
    .background(ChiefTheme.background)
    .task(id: model.workspace?.id) {
      files = []
      await load()
    }
    .quickLookPreview($preview)
    .alert(
      "Couldn’t open file",
      isPresented: Binding(
        get: { openError != nil },
        set: { if !$0 { openError = nil } }
      )
    ) {
      Button("OK", role: .cancel) { openError = nil }
    } message: {
      Text(openError ?? "Try again.")
    }
  }

  /// All, then each kind the workspace has, in desktop's order.
  private var kindOptions: [ChiefModePicker<String?>.Option] {
    let present = Set(files.map(\.kind))
    let kinds: [(String, String)] = [
      ("Page", "rectangle.3.group"), ("Document", "doc.text"), ("Image", "photo"),
      ("Media", "play.rectangle"), ("Other", "doc"),
    ]
    return [.init(value: nil, symbol: "square.grid.2x2", label: "All")]
      + kinds.filter { present.contains($0.0) }.map { .init(value: $0.0, symbol: $0.1, label: "\($0.0)s") }
  }

  private var filteredFiles: [WorkspaceFileRecord] {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return files.filter {
      (kind == nil || $0.kind == kind)
        && (query.isEmpty
          || $0.title.localizedCaseInsensitiveContains(query) || $0.kind.localizedCaseInsensitiveContains(query))
    }
  }

  @ViewBuilder
  private func row(_ file: WorkspaceFileRecord) -> some View {
    let conversation = model.workspace?.conversations.first { $0.id == file.conversationId }
    let place = conversation.map { $0.kind == .channel ? "#\($0.name)" : $0.name } ?? "Workspace"
    let label = ArtifactRow(
      symbol: file.symbol, title: file.title, subtitle: "\(file.kind) · \(place)",
      updated: file.updated, opening: openingFileID == file.id)
    if let asset = file.asset {
      Button { open(file, asset: asset) } label: { label }
        .buttonStyle(.plain)
        .disabled(openingFileID != nil)
    } else {
      NavigationLink { ArtifactDetailView(file: file) } label: { label }
        .buttonStyle(.plain)
        .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
    }
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    loading = true
    error = nil
    do {
      let fetched = try await model.relay.listWorkspaceFiles(workspaceID: workspaceID, signingIdentity: nil)
      guard !Task.isCancelled, model.workspace?.id == workspaceID else { return }
      files = fetched.sorted { $0.updatedAt > $1.updatedAt }
    } catch {
      guard !Task.isCancelled, model.workspace?.id == workspaceID else { return }
      self.error = "Could not load artifacts. Please try again."
    }
    loading = false
  }

  /// Media bytes live in the relay's artifact store, so download them before
  /// Quick Look can show them; Quick Look also offers sharing.
  private func open(_ file: WorkspaceFileRecord, asset: WorkspaceFileAsset) {
    guard let workspaceID = model.workspace?.id else { return }
    Haptics.medium()
    openingFileID = file.id
    Task {
      defer { openingFileID = nil }
      do {
        preview = try await file.download(asset, workspaceID: workspaceID, relay: model.relay)
      } catch {
        Haptics.error()
        openError = error.localizedDescription
      }
    }
  }
}

/// An artifact row, matching the Plugins and Projects rows.
struct ArtifactRow: View {
  let symbol: String
  let title: String
  let subtitle: String
  let updated: Date?
  var opening = false

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: symbol)
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(.primary)
        .frame(width: 40, height: 40)
        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).stroke(ChiefTheme.line) }
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 15, weight: .medium))
        Text(subtitle)
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
      }
      .lineLimit(1)
      Spacer(minLength: 8)
      if opening {
        ChiefSpinner()
          .controlSize(.small)
          .tint(ChiefTheme.accent)
      } else if let updated {
        Text(updated.formatted(.dateTime.day().month(.abbreviated)))
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.tertiary)
      }
    }
    .frame(minHeight: 62)
    .contentShape(Rectangle())
  }
}

private struct ArtifactDetailView: View {
  let file: WorkspaceFileRecord

  var body: some View {
    VStack(spacing: 0) {
      PageDetailBar(title: file.title) {
        ShareLink(item: file.content, subject: Text(file.title), preview: SharePreview(file.title)) {
          PageBarIcon(systemName: "square.and.arrow.up")
        }
      }
      ArtifactContent(file: file)
    }
    .background(ChiefTheme.background.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .background(InteractivePopEnabler())
  }
}

extension WorkspaceFileRecord {
  /// The desktop Artifacts kinds, singular.
  var kind: String {
    if mimeType == "text/html" || mimeType == "application/vnd.chief.page+json" { return "Page" }
    if mimeType.hasPrefix("image/") { return "Image" }
    if mimeType.hasPrefix("video/") || mimeType.hasPrefix("audio/") { return "Media" }
    if mimeType.hasPrefix("text/") || mimeType == "message/rfc822" || mimeType == "application/pdf" {
      return "Document"
    }
    return "Other"
  }

  var symbol: String {
    if mimeType.hasPrefix("image/") { return "photo" }
    if mimeType.hasPrefix("video/") { return "video" }
    if mimeType.hasPrefix("audio/") { return "waveform" }
    if mimeType == "message/rfc822" { return "envelope" }
    if mimeType == "application/vnd.chief.page+json" { return "rectangle.3.group" }
    if mimeType == "text/html" { return "macwindow" }
    return kind == "Document" ? "doc.text" : "doc"
  }

  var updated: Date? {
    ISO8601DateFormatter.chief().date(from: updatedAt)
      ?? ISO8601DateFormatter.noFraction().date(from: updatedAt)
  }

  /// Media bytes live in the relay's artifact store; Quick Look needs a local copy.
  func download(_ asset: WorkspaceFileAsset, workspaceID: String, relay: any RelayServing) async throws -> URL {
    let data = try await relay.workspaceAsset(workspaceID: workspaceID, asset: asset)
    let folder = URL.temporaryDirectory.appending(path: asset.artifactId, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appending(path: fileName)
    try data.write(to: url, options: .atomic)
    return url
  }

  /// The downloaded copy's name; keeps an extension so Quick Look knows the type.
  private var fileName: String {
    let name = (path as NSString).lastPathComponent
    guard (name as NSString).pathExtension.isEmpty,
      let pathExtension = UTType(mimeType: mimeType)?.preferredFilenameExtension
    else { return name }
    return "\(name).\(pathExtension)"
  }
}

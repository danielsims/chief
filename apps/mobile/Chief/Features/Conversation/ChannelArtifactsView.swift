import QuickLook
import SwiftUI

/// What a channel's people and agents have made: its files, and the boards and
/// databases that show in it.
@MainActor
@Observable
final class ChannelArtifacts {
  private(set) var files: [WorkspaceFileRecord] = []
  private(set) var databases: [WorkspaceDatabase] = []
  /// Pages that are only a board, by file id, to the database they show.
  private(set) var boardPages: [String: String] = [:]
  private(set) var filesLoaded = false
  private(set) var databasesLoaded = false
  private(set) var error: String?

  func load(conversationID: String, model: AppModel) async {
    guard let workspaceID = model.workspace?.id else { return }
    error = nil
    async let files = model.relay.listWorkspaceFiles(workspaceID: workspaceID, signingIdentity: nil)
    async let databases = model.relay.databases(workspaceID: workspaceID)
    do {
      let fetched = try await files
      guard !Task.isCancelled, model.workspace?.id == workspaceID else { return }
      self.files = fetched.filter { $0.conversationId == conversationID }
      boardPages = self.files.reduce(into: [:]) { pages, file in pages[file.id] = file.boardDatabaseID }
      filesLoaded = true
    } catch {
      guard !Task.isCancelled else { return }
      self.error = "Could not load this channel's artifacts. Please try again."
    }
    // A database that can't be read only leaves the files showing.
    if let fetched = try? await databases, !Task.isCancelled, model.workspace?.id == workspaceID {
      self.databases = fetched.filter { $0.channels?.contains(conversationID) == true }
      databasesLoaded = true
    }
  }

  /// A page that is only a board is that board's database, not a second tab.
  func canonical(_ tab: ChannelTab) -> ChannelTab {
    guard tab.kind == .file, let databaseID = boardPages[tab.id] else {
      return tab
    }
    let name = databases.first { $0.id == databaseID }?.name ?? tab.name
    return ChannelTab(kind: .database, id: databaseID, name: name)
  }

  /// The channel's boards, always in the strip, then the tabs opened, without
  /// ones that are gone.
  func items(opened: [ChannelTab]) -> [ChannelViewTabs.Item] {
    let pinned = databases.filter(\.isBoard).map { ChannelTab(kind: .database, id: $0.id, name: $0.name) }
    var seen = Set<ChannelTab>()
    return (pinned + opened).map(canonical).compactMap { tab in
      guard seen.insert(tab).inserted else { return nil }
      switch tab.kind {
      case .file:
        let file = files.first { $0.id == tab.id }
        if filesLoaded && file == nil { return nil }
        return .init(
          tab: tab, name: file?.title ?? tab.name ?? "Artifact", symbol: "doc.text", closable: true)
      case .database:
        let database = databases.first { $0.id == tab.id }
        if databasesLoaded && database == nil { return nil }
        return .init(
          tab: tab,
          name: database?.name ?? tab.name ?? "Database",
          symbol: database?.symbol ?? WorkspaceDatabase.boardSymbol,
          closable: !pinned.contains(tab)
        )
      }
    }
  }
}

/// A channel's artifacts, newest first whatever kind they are. Each opens in
/// place as a tab; uploaded media opens in Quick Look.
struct ChannelArtifactsList: View {
  @Environment(AppModel.self) private var model
  let channelName: String
  let artifacts: ChannelArtifacts
  let open: (ChannelTab) -> Void
  let refresh: () async -> Void
  @State private var openingFileID: String?
  @State private var preview: URL?
  @State private var openError: String?

  private enum Entry: Identifiable {
    case database(WorkspaceDatabase)
    case file(WorkspaceFileRecord)

    var id: String {
      switch self {
      case .database(let database): "database:\(database.id)"
      case .file(let file): "file:\(file.id)"
      }
    }

    var updated: Date? {
      switch self {
      case .database(let database): database.updated
      case .file(let file): file.updated
      }
    }
  }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        if !artifacts.filesLoaded && !artifacts.databasesLoaded && artifacts.error == nil {
          ChiefSpinner()
            .tint(ChiefTheme.accent)
            .frame(maxWidth: .infinity)
            .padding(.top, 36)
        } else if let error = artifacts.error, entries.isEmpty {
          ContentUnavailableView {
            Label("Artifacts unavailable", systemImage: "wifi.slash")
          } description: {
            Text(error)
          } actions: {
            Button("Try again") { Task { await refresh() } }
          }
          .foregroundStyle(ChiefTheme.secondary)
          .containerRelativeFrame(.vertical)
        } else if entries.isEmpty {
          ContentUnavailableView(
            "Nothing here yet", systemImage: "folder",
            description: Text("Documents, pages and databases made in #\(channelName) live here."))
          .foregroundStyle(ChiefTheme.secondary)
          // Fills the visible page, so the message sits in its middle.
          .containerRelativeFrame(.vertical)
        } else {
          ForEach(entries) { row($0) }
        }
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.bottom, ChiefTheme.pagePadding)
    }
    .refreshable { await refresh() }
    // Agents make things while the channel is open, so read them again here.
    .task { await refresh() }
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

  private var entries: [Entry] {
    let files = artifacts.files.filter { artifacts.boardPages[$0.id] == nil }
    return (artifacts.databases.map(Entry.database) + files.map(Entry.file))
      .sorted { ($0.updated ?? .distantPast) > ($1.updated ?? .distantPast) }
  }

  @ViewBuilder
  private func row(_ entry: Entry) -> some View {
    switch entry {
    case .database(let database):
      Button {
        Haptics.medium()
        open(ChannelTab(kind: .database, id: database.id, name: database.name))
      } label: {
        ArtifactRow(
          symbol: database.symbol, title: database.name, subtitle: database.isBoard ? "Board" : "Database",
          updated: database.updated)
      }
      .buttonStyle(.plain)
    case .file(let file):
      Button {
        Haptics.medium()
        if let asset = file.asset {
          download(file, asset: asset)
        } else {
          open(ChannelTab(kind: .file, id: file.id, name: file.title))
        }
      } label: {
        ArtifactRow(
          symbol: file.symbol, title: file.title, subtitle: file.channelKind, updated: file.updated,
          opening: openingFileID == file.id)
      }
      .buttonStyle(.plain)
      .disabled(openingFileID != nil)
    }
  }

  private func download(_ file: WorkspaceFileRecord, asset: WorkspaceFileAsset) {
    guard let workspaceID = model.workspace?.id else { return }
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

/// An artifact opened as a channel tab, shown in place.
struct ChannelArtifactTab: View {
  let tab: ChannelTab
  let artifacts: ChannelArtifacts
  let refresh: () async -> Void

  var body: some View {
    switch tab.kind {
    case .file:
      if let file = artifacts.files.first(where: { $0.id == tab.id }) {
        ArtifactContent(file: file)
      } else if artifacts.filesLoaded {
        unavailable
      } else {
        loading
      }
    case .database:
      if let database = artifacts.databases.first(where: { $0.id == tab.id }) {
        BoardView(database: database, refreshList: refresh)
          .padding(.top, 12)
          .frame(maxHeight: .infinity, alignment: .top)
      } else if artifacts.databasesLoaded {
        unavailable
      } else {
        loading
      }
    }
  }

  private var loading: some View {
    ChiefSpinner()
      .tint(ChiefTheme.accent)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var unavailable: some View {
    ContentUnavailableView {
      Label("Artifact unavailable", systemImage: "doc.text")
    } description: {
      Text("It may have been deleted.")
    } actions: {
      Button("Try again") { Task { await refresh() } }
    }
    .foregroundStyle(ChiefTheme.secondary)
    .frame(maxHeight: .infinity)
  }
}

extension WorkspaceDatabase {
  static let boardSymbol = "rectangle.split.3x1"

  var symbol: String { isBoard ? Self.boardSymbol : "tablecells" }
  var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

private extension WorkspaceFileRecord {
  /// The desktop channel Artifacts kinds.
  var channelKind: String {
    if asset != nil { return "Media" }
    if kind == "Page" { return "Page" }
    return mimeType == "text/csv" ? "Spreadsheet" : "Document"
  }

  /// The database a page shows when the page is only a board of it (`pageBoard`).
  var boardDatabaseID: String? {
    guard mimeType == "application/vnd.chief.page+json",
      let page = try? JSONDecoder().decode(JSONValue.self, from: Data(content.utf8)),
      case .object(let document) = page,
      case .object(let spec)? = document["spec"],
      case .string(let root)? = spec["root"],
      case .object(let elements)? = spec["elements"],
      case .object(let element)? = elements[root],
      element["type"] == .string("Board"),
      element["visible"] == nil || element["visible"] == .bool(true),
      case .object(let props)? = element["props"],
      case .string(let source)? = props["source"],
      case .object(let sources)? = document["sources"],
      case .object(let reference)? = sources[source],
      case .string(let database)? = reference["database"]
    else { return nil }
    return database
  }
}

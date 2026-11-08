import SwiftUI

/// The workspace's boards as cards, as Automations lists its automations;
/// each opens on its own page with its lanes side by side.
struct BoardsView: View {
  @Environment(AppModel.self) private var model
  @State private var boards: [WorkspaceDatabase]?
  @State private var failed = false

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Boards")
          .font(.system(size: 26, weight: .regular, design: .rounded))
          .tracking(-0.6)
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 16)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          if let boards, boards.isEmpty {
            ContentUnavailableView("No boards yet", systemImage: "rectangle.split.3x1")
              .foregroundStyle(ChiefTheme.secondary)
              .padding(.top, 36)
          } else if let boards {
            ForEach(boards) { board in
              NavigationLink {
                BoardDetailView(database: board, refreshList: loadBoards)
              } label: {
                BoardRow(board: board)
              }
              .buttonStyle(.plain)
              .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
            }
          } else if failed {
            BoardUnavailableView(title: "Couldn’t load boards") { Task { await loadBoards() } }
          } else {
            BoardSpinner()
          }
        }
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.top, 2)
        .padding(.bottom, ChiefTheme.pagePadding)
      }
      .refreshable { await loadBoards() }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(ChiefTheme.background)
    .task(id: model.workspace?.id) { await loadBoards() }
  }

  /// The workspace's boards, with the workspace board first.
  private func loadBoards() async {
    guard let workspaceID = model.workspace?.id else { return }
    do {
      boards = try await model.relay.databases(workspaceID: workspaceID)
        .filter(\.isBoard)
        .sorted {
          ($0.id == WorkspaceDatabase.workspaceBoardID ? 0 : 1, $0.name.lowercased())
            < ($1.id == WorkspaceDatabase.workspaceBoardID ? 0 : 1, $1.name.lowercased())
        }
      failed = false
    } catch {
      failed = true
    }
  }
}

/// A board as a card: where it shows and when it changed in the band, its
/// name and how much is on it in the card.
private struct BoardRow: View {
  @Environment(AppModel.self) private var model
  let board: WorkspaceDatabase

  var body: some View {
    InsetBand {
      Text(place).frame(maxWidth: .infinity, alignment: .leading)
      if board.updatedAt > 0 {
        Text(Date(timeIntervalSince1970: board.updatedAt / 1000), format: .relative(presentation: .named))
      }
      Image(systemName: "arrow.up.right")
        .font(.system(size: 11))
        .foregroundStyle(ChiefTheme.tertiary)
    } content: {
      VStack(alignment: .leading, spacing: 10) {
        Text(board.name)
          .font(.system(size: 15, weight: .medium))
          .foregroundStyle(ChiefTheme.accent)
          .multilineTextAlignment(.leading)
          .lineLimit(2)
        BoardSummary(board: board)
      }
    }
    .contentShape(Rectangle())
  }

  private var place: String {
    let names = (board.channels ?? []).compactMap { id in
      model.workspace?.conversations.first { $0.id == id }.map { "#\($0.name)" }
    }
    return names.isEmpty ? "Workspace" : names.joined(separator: ", ")
  }
}

/// How much is on the board, in one quiet line.
private struct BoardSummary: View {
  @Environment(AppModel.self) private var model
  let board: WorkspaceDatabase
  @State private var contents = BoardContents()

  var body: some View {
    Text(summary)
      .font(.system(size: 12))
      .foregroundStyle(ChiefTheme.secondary)
      .task(id: "\(model.workspace?.id ?? "")/\(board.id)") { await contents.load(board, model: model) }
  }

  private var summary: String {
    let lanes = board.group?.options?.count ?? 0
    let laneText = "\(lanes) \(lanes == 1 ? "lane" : "lanes")"
    guard let items = contents.rows?.count else { return laneText }
    return "\(items) action \(items == 1 ? "item" : "items") · \(laneText)"
  }
}

/// One board on its own page, lanes side by side.
private struct BoardDetailView: View {
  let database: WorkspaceDatabase
  let refreshList: () async -> Void

  var body: some View {
    VStack(spacing: 0) {
      PageDetailBar(title: database.name)
      BoardView(database: database, refreshList: refreshList)
        .padding(.top, 12)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(ChiefTheme.background.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .background(InteractivePopEnabler())
  }
}

/// A board's lanes and its open card, as the Boards tab and a channel's board
/// tab show it.
struct BoardView: View {
  @Environment(AppModel.self) private var model
  let database: WorkspaceDatabase
  /// Reads the boards around this one again, when pulled to refresh.
  var refreshList: () async -> Void = {}
  @State private var board = BoardContents()
  @State private var openRowID: String?

  var body: some View {
    BoardLanes(board: board, refresh: refresh) { openRowID = $0 }
      .task(id: "\(model.workspace?.id ?? "")/\(database.id)") { await board.load(database, model: model) }
      .navigationDestination(item: $openRowID) { id in
        if let database = board.database, let row = board.rows?.first(where: { $0.id == id }) {
          BoardCardView(database: database, row: row) { board.move(row, to: $0, model: model) }
        }
      }
  }

  private func refresh() async {
    await refreshList()
    await board.load(database, model: model)
  }
}

/// One option of the field the board groups by, or the cards with none.
private struct BoardLane: Identifiable {
  /// The lane for cards with no value, as desktop's `noneLane`.
  static let noneID = ":none"

  let id: String
  let name: String
  let color: String?
  let rows: [WorkspaceDatabaseRow]
}

/// A board's contents, shared by its lanes and the open card so a card moved
/// in one is already moved in the other.
@MainActor
@Observable
private final class BoardContents {
  private(set) var database: WorkspaceDatabase?
  var rows: [WorkspaceDatabaseRow]?
  private(set) var failed = false
  private var workspaceID: String?

  /// Loads `board`, clearing what was shown first when it's another board.
  func load(_ board: WorkspaceDatabase, model: AppModel) async {
    guard let workspaceID = model.workspace?.id else { return }
    if self.workspaceID != workspaceID || database?.id != board.id {
      self.workspaceID = workspaceID
      database = board
      rows = nil
      failed = false
    }
    do {
      let contents = try await model.relay.database(workspaceID: workspaceID, databaseID: board.id)
      guard self.workspaceID == workspaceID, database?.id == board.id else { return }
      database = contents.database
      rows = contents.rows.sorted { $0.position < $1.position }
      failed = false
    } catch {
      if self.workspaceID == workspaceID, database?.id == board.id { failed = true }
    }
  }

  var lanes: [BoardLane]? {
    guard let database, let rows else { return nil }
    let group = database.group
    let options = group?.options ?? []
    let byLane = Dictionary(grouping: rows) { lane(of: $0, in: database) }
    let none = BoardLane(
      id: BoardLane.noneID,
      name: group.map { "No \($0.name.lowercased())" } ?? database.name,
      color: nil,
      rows: byLane[BoardLane.noneID] ?? []
    )
    // Cards with no value only get a lane while there are some.
    return (none.rows.isEmpty && !options.isEmpty ? [] : [none])
      + options.map { BoardLane(id: $0.id, name: $0.name, color: $0.color, rows: byLane[$0.id] ?? []) }
  }

  private func lane(of row: WorkspaceDatabaseRow, in database: WorkspaceDatabase) -> String {
    guard let group = database.group, case .string(let value) = row.values[group.id],
      group.options?.contains(where: { $0.id == value }) == true
    else { return BoardLane.noneID }
    return value
  }

  /// Moves the card with `rowID` into `laneID`, as dropping it there does.
  func move(rowID: String, to laneID: String, model: AppModel) {
    guard let database, let row = rows?.first(where: { $0.id == rowID }),
      lane(of: row, in: database) != laneID
    else { return }
    move(row, to: laneID, model: model)
  }

  /// Shows the card in its new lane at once; puts it back if the save fails.
  func move(_ row: WorkspaceDatabaseRow, to laneID: String, model: AppModel) {
    guard let database, let group = database.group, let workspaceID = model.workspace?.id,
      let index = rows?.firstIndex(where: { $0.id == row.id })
    else { return }
    Haptics.medium()
    let value: [String: JSONValue] = [group.id: laneID == BoardLane.noneID ? .null : .string(laneID)]
    rows?[index].values.merge(value) { $1 }
    Task {
      do {
        let saved = try await model.relay.saveDatabaseRow(
          workspaceID: workspaceID,
          databaseID: database.id,
          rowID: row.id,
          values: value
        )
        replace(saved)
      } catch {
        replace(row)
        Haptics.error()
      }
    }
  }

  private func replace(_ row: WorkspaceDatabaseRow) {
    guard let index = rows?.firstIndex(where: { $0.id == row.id }) else { return }
    rows?[index] = row
  }
}

/// The board itself: lanes side by side, two to the screen, scrolling
/// sideways under the title and switcher. Past the first or last lane the
/// drag carries on into the workspace pager, as UIKit hands a nested scroll
/// view's overscroll to its parent.
private struct BoardLanes: View {
  let board: BoardContents
  let refresh: () async -> Void
  let open: (String) -> Void

  var body: some View {
    if let lanes = board.lanes, let database = board.database {
      ScrollView(.horizontal) {
        HStack(alignment: .top, spacing: 8) {
          ForEach(lanes) { lane in
            BoardLaneColumn(lane: lane, database: database, board: board, refresh: refresh, open: open)
              .containerRelativeFrame(.horizontal, count: 2, spacing: 8)
          }
        }
        .scrollTargetLayout()
        .padding(.bottom, 12)
      }
      .contentMargins(.horizontal, ChiefTheme.pagePadding, for: .scrollContent)
      .scrollTargetBehavior(.viewAligned)
      .scrollIndicators(.hidden)
    } else if board.failed {
      BoardUnavailableView(title: "Couldn’t load this board") { Task { await refresh() } }
    } else {
      BoardSpinner()
    }
  }
}

/// A lane as desktop draws it: a soft band with its colour, name and count,
/// holding its cards. It's as tall as its cards up to the screen, then
/// scrolls them. Cards are dropped in to move them here.
private struct BoardLaneColumn: View {
  @Environment(AppModel.self) private var model
  let lane: BoardLane
  let database: WorkspaceDatabase
  let board: BoardContents
  let refresh: () async -> Void
  let open: (String) -> Void
  @State private var cardsHeight = CGFloat.infinity
  @State private var targeted = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 6) {
        if let color = lane.color {
          Circle().fill(laneColor(color)).frame(width: 7, height: 7)
        }
        Text(lane.name)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(lane.color == nil ? ChiefTheme.secondary : .primary)
          .lineLimit(1)
        Text("\(lane.rows.count)")
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .monospacedDigit()
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 8)
      .frame(height: 32)
      ScrollView {
        LazyVStack(spacing: 4) {
          ForEach(lane.rows) { row in
            Button {
              Haptics.medium()
              open(row.id)
            } label: {
              BoardCard(database: database, row: row)
            }
            .buttonStyle(.plain)
            .draggable(row.id) {
              // Drag previews don't inherit the environment.
              BoardCard(database: database, row: row).frame(width: 170).environment(model)
            }
            .contextMenu {
              if let group = database.group {
                LanePicker(group: group, row: row) { board.move(row, to: $0, model: model) }
              }
            }
          }
        }
        .frame(minHeight: lane.rows.isEmpty ? 52 : 0)
      }
      .onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height } action: { _, height in
        cardsHeight = height
      }
      .frame(maxHeight: cardsHeight)
      .refreshable { await refresh() }
    }
    .padding(4)
    .background(ChiefTheme.accent.opacity(0.04), in: InsetShape.band)
    .overlay {
      InsetShape.band.strokeBorder(ChiefTheme.accent.opacity(targeted ? 0.3 : 0.07))
    }
    .dropDestination(for: String.self) { ids, _ in
      for id in ids { board.move(rowID: id, to: lane.id, model: model) }
      return !ids.isEmpty
    } isTargeted: { targeted = $0 }
    .frame(maxHeight: .infinity, alignment: .top)
  }
}

private struct BoardSpinner: View {
  var body: some View {
    ChiefSpinner()
      .tint(ChiefTheme.accent)
      .frame(maxWidth: .infinity)
      .padding(.top, 36)
  }
}

/// Desktop's `RowCard`: the title, a line of its page, its first text fields
/// and who it's for.
private struct BoardCard: View {
  @Environment(AppModel.self) private var model
  let database: WorkspaceDatabase
  let row: WorkspaceDatabaseRow

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title(of: row, in: database))
        .font(.system(size: 14, weight: .medium))
        .tracking(-0.1)
        .foregroundStyle(hasTitle ? .primary : ChiefTheme.secondary)
        .lineLimit(2)
      if let excerpt {
        Text(excerpt)
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(2)
          .padding(.top, 3)
      }
      if !details.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          ForEach(details, id: \.field.id) { detail in
            VStack(alignment: .leading, spacing: 1) {
              Text(detail.field.name)
                .font(.system(size: 10))
                .foregroundStyle(ChiefTheme.tertiary)
              Text(detail.text)
                .font(.system(size: 12))
                .foregroundStyle(ChiefTheme.secondary)
                .lineLimit(1)
            }
          }
        }
        .padding(.top, 8)
      }
      if let person = database.fields.first(where: { $0.type == "person" }),
        let assignee = model.boardPerson(row.values[person.id])
      {
        HStack(spacing: 5) {
          assignee
          Text(assignee.name)
            .lineLimit(1)
        }
        .font(.system(size: 11))
        .foregroundStyle(ChiefTheme.secondary)
        .padding(.top, 8)
      }
    }
    .multilineTextAlignment(.leading)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 10)
    .padding(.vertical, 9)
    .background(ChiefTheme.background, in: InsetShape.card)
    .overlay { InsetShape.card.strokeBorder(ChiefTheme.accent.opacity(0.08)) }
    .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
    .contentShape(.dragPreview, InsetShape.card)
    .contentShape(.contextMenuPreview, InsetShape.card)
  }

  private var hasTitle: Bool { title(of: row, in: database) != "Untitled" }

  /// The page as one plain line, as desktop's `plainText`.
  private var excerpt: String? {
    guard !row.body.isEmpty else { return nil }
    let text = (try? AttributedString(markdown: row.body)).map { String($0.characters) } ?? row.body
    let line = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return line.isEmpty ? nil : line
  }

  /// The first two text fields with something in them.
  private var details: [(field: WorkspaceDatabase.Field, text: String)] {
    database.fields
      .filter { $0.type == "text" }
      .compactMap { field in
        guard case .string(let text) = row.values[field.id], !text.isEmpty else { return nil }
        return (field, text)
      }
      .prefix(2)
      .map { $0 }
  }
}

/// A card's fields and page, with its column as the one thing to change.
private struct BoardCardView: View {
  @Environment(AppModel.self) private var model
  let database: WorkspaceDatabase
  let row: WorkspaceDatabaseRow
  let move: (String) -> Void

  var body: some View {
    VStack(spacing: 0) {
      PageDetailBar(title: database.name)
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text(title(of: row, in: database))
            .font(.system(size: 20, weight: .semibold))
            .fixedSize(horizontal: false, vertical: true)
          ChiefCard {
            VStack(spacing: 0) {
              ForEach(Array(fields.enumerated()), id: \.element.id) { index, field in
                HStack(spacing: 12) {
                  Text(field.name)
                    .foregroundStyle(ChiefTheme.secondary)
                  Spacer(minLength: 8)
                  if field.id == database.group?.id {
                    LanePicker(group: field, row: row, move: move)
                      .pickerStyle(.menu)
                      .tint(.primary)
                  } else {
                    Text(model.cellText(field, in: row) ?? "")
                      .lineLimit(1)
                  }
                }
                .font(.system(size: 14))
                .frame(minHeight: 44)
                if index < fields.count - 1 {
                  Divider().overlay(ChiefTheme.line)
                }
              }
            }
            .padding(.vertical, -6)
          }
          if !row.body.isEmpty {
            MarkdownMessageBody(source: row.body, channelNames: [])
          }
        }
        .padding(ChiefTheme.pagePadding)
        .padding(.bottom, 28)
      }
    }
    .background(ChiefTheme.background.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .background(InteractivePopEnabler())
  }

  /// Every field but the title that holds something, and always the column.
  private var fields: [WorkspaceDatabase.Field] {
    database.fields.dropFirst().filter {
      $0.id == database.group?.id || model.cellText($0, in: row) != nil
    }
  }
}

/// Picks which column a card sits in.
private struct LanePicker: View {
  let group: WorkspaceDatabase.Field
  let row: WorkspaceDatabaseRow
  let move: (String) -> Void

  var body: some View {
    Picker(
      group.name,
      selection: Binding<String?>(
        get: {
          guard case .string(let value) = row.values[group.id] else { return nil }
          return value
        },
        set: { if let id = $0 { move(id) } }
      )
    ) {
      ForEach(group.options ?? []) { option in
        Text(option.name).tag(Optional(option.id))
      }
    }
  }
}

private struct BoardUnavailableView: View {
  let title: String
  let retry: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label(title, systemImage: "wifi.slash")
    } description: {
      Text("Check your connection and try again.")
    } actions: {
      Button("Try again", action: retry)
    }
    .foregroundStyle(ChiefTheme.secondary)
  }
}

/// The title field is always first.
private func title(of row: WorkspaceDatabaseRow, in database: WorkspaceDatabase) -> String {
  guard let field = database.fields.first, case .string(let title) = row.values[field.id],
    !title.isEmpty
  else { return "Untitled" }
  return title
}

/// Mirrors the desktop palette's `DatabaseColor`s.
private func laneColor(_ color: String) -> Color {
  switch color {
  case "blue": .blue
  case "green": .green
  case "amber": .orange
  case "red": .red
  case "purple": .purple
  default: .gray
  }
}

/// Who a person cell points at: a workspace member or an agent.
private enum BoardPerson: View {
  case user(ChiefUser)
  case agent(id: String, name: String)

  var name: String {
    switch self {
    case .user(let user): user.name
    case .agent(_, let name): name
    }
  }

  var body: some View {
    switch self {
    case .user(let user): UserAvatar(user: user, size: 16)
    case .agent(let id, let name): AgentMark(name: name, id: id, size: 16)
    }
  }
}

private extension AppModel {
  /// A cell as one line: a select's option name, a person's or agent's name.
  func cellText(_ field: WorkspaceDatabase.Field, in row: WorkspaceDatabaseRow) -> String? {
    switch row.values[field.id] {
    case .string(let value):
      return field.options?.first { $0.id == value }?.name ?? value
    case .number(let value):
      return value.formatted()
    case .bool(let value):
      return value ? "Yes" : "No"
    case let value:
      return boardPerson(value)?.name
    }
  }

  func boardPerson(_ value: JSONValue?) -> BoardPerson? {
    guard case .object(let person) = value, case .string(let kind) = person["kind"],
      case .string(let id) = person["id"]
    else { return nil }
    if kind == "user" { return .user(self.person(userID: id)) }
    return .agent(id: id, name: workspace?.agents.lazy.compactMap { $0.profile(id: id) }.first?.name ?? id)
  }
}

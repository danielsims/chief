import BrowserUI
import SwiftUI
import UIKit

/// The row every compact chat card shares: an icon tile, a title and a line
/// of detail, and an optional trailing control.
private struct CompactChatCard<Trailing: View>: View {
  let symbol: String
  let title: String
  let detail: String?
  @ViewBuilder var trailing: Trailing

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: symbol)
        .font(.system(size: 16))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 36, height: 36)
        .background(ChiefTheme.background, in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(ChiefTheme.line, lineWidth: 0.5))
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 14, weight: .medium))
          .lineLimit(1)
        if let detail {
          Text(detail)
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      trailing
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .chatCardBackground()
  }
}

extension View {
  fileprivate func chatCardBackground() -> some View {
    background(ChiefTheme.elevated.opacity(0.5), in: RoundedRectangle(cornerRadius: 16))
      .overlay(RoundedRectangle(cornerRadius: 16).stroke(ChiefTheme.line, lineWidth: 0.5))
  }
}

private func siteName(_ raw: String?) -> String? {
  guard let raw, let host = URL(string: raw)?.host else { return nil }
  return host.replacingOccurrences(of: "www.", with: "")
}

// MARK: - Browser

/// An agent's browser, drawn with browser-ui as the desktop draws it: live
/// in its framed chrome while it's open, the package's ended card after.
struct BrowserActivityMessageComponent: View {
  let message: ConversationMessage
  let component: MessageComponent

  private var url: String? { component.payload["url"] }
  private var sessionID: String? { component.payload["browserRunId"] }
  /// Paired computers stream through their own tunnel; a local agent's
  /// browser streams on its own computer, which a phone can't reach.
  private var isMachineStream: Bool {
    guard let stream = component.payload["streamUrl"] else { return false }
    return stream.range(of: #"^wss://m-[0-9a-f-]{36}\."#, options: .regularExpression) != nil
  }

  var body: some View {
    if component.payload["status"] == "closed" {
      BrowserSessionEndedView()
    } else if isMachineStream, let sessionID, let agentID = message.author.agentID {
      LiveMachineBrowserCard(
        workspaceID: message.workspaceID,
        conversationID: message.conversationID,
        agentID: agentID,
        sessionID: sessionID
      )
    } else {
      CompactChatCard(
        symbol: "safari",
        title: siteName(url).map { "Browsing \($0)" } ?? "Browsing",
        detail: "Watch it in Chief on the computer it's running on."
      ) { EmptyView() }
    }
  }
}

/// A paired computer's browser: Chief resolves the one-time viewer ticket
/// and ends sessions through the relay; browser-ui does the rest.
private struct LiveMachineBrowserCard: View {
  @Environment(AppModel.self) private var model
  let workspaceID: String
  let conversationID: String
  let agentID: String
  let sessionID: String

  /// The agent is working in this conversation, so its browser shows
  /// browser-ui's operating shader and what it's doing.
  private var operating: Bool {
    model.workingAgents[ConversationKey(workspaceID: workspaceID, conversationID: conversationID)]?
      .contains(agentID) == true
  }
  @State private var driver: BrowserStreamDriver?
  @State private var showsTakeover = false
  @State private var endError: String?

  var body: some View {
    Group {
      if let driver, driver.ended {
        BrowserSessionEndedView()
      } else {
        BrowserFrame {
          Group {
            if let driver {
              BrowserStreamView(driver: driver) { OpeningBrowser(onDark: false) }
                .overlay {
                  if operating {
                    BrowserOperatingOverlay(label: driver.activityLabel ?? "Working in this browser")
                      .allowsHitTesting(false)
                      .transition(.opacity)
                  }
                }
                .animation(.easeOut(duration: 0.25), value: operating)
            } else {
              OpeningBrowser(onDark: false)
            }
          }
          // The desktop page's shape, so the card never changes size.
          .aspectRatio(1280.0 / 800.0, contentMode: .fit)
          .contentShape(Rectangle())
          .onTapGesture {
            guard driver != nil else { return }
            Haptics.medium()
            showsTakeover = true
          }
          .accessibilityAddTraits(.isButton)
          .accessibilityLabel("Take over the agent's browser")
        }
        .overlay(alignment: .topTrailing) {
          if let driver {
            HStack(spacing: 8) {
              BrowserStreamSoundButton(driver: driver)
              BrowserEndSessionButton { await end(driver) }
            }
            .padding(14)
          }
        }
      }
    }
    .onAppear(perform: start)
    .onDisappear { driver?.disconnect() }
    .fullScreenCover(isPresented: $showsTakeover) {
      if let driver {
        MachineBrowserTakeover(driver: driver, operating: operating, isPresented: $showsTakeover) {
          await end(driver)
        }
      }
    }
    .alert(
      "Browser not stopped",
      isPresented: Binding(get: { endError != nil }, set: { if !$0 { endError = nil } })
    ) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(endError ?? "")
    }
  }

  private func start() {
    guard driver == nil else { return }
    let relay = model.relay
    let (workspaceID, agentID, sessionID) = (workspaceID, agentID, sessionID)
    guard
      let driver = try? BrowserStreamDriver(
        id: "chief-machine",
        sessionId: sessionID,
        resolveConnection: {
          let ticket = try await relay.machineViewerTicket(
            workspaceID: workspaceID, agentID: agentID, sessionID: sessionID)
          return BrowserStreamConnection(url: ticket.url, protocols: ticket.protocols)
        },
        endSession: {
          try await relay.stopMachineBrowser(
            workspaceID: workspaceID, agentID: agentID, sessionID: sessionID)
        }
      )
    else { return }
    self.driver = driver
    driver.begin(scope: "\(workspaceID):\(agentID):\(sessionID)")
  }

  private func end(_ driver: BrowserStreamDriver) async {
    do {
      try await driver.endSession()
      showsTakeover = false
    } catch RelayError.httpStatus(403) {
      endError = "Only the agent's owner can stop its browser."
      Haptics.error()
    } catch {
      endError = "The browser couldn't be stopped. Try again."
      Haptics.error()
    }
  }
}

/// Chief's loading look for a browser, as the desktop's `loadingFallback`.
private struct OpeningBrowser: View {
  var onDark: Bool

  var body: some View {
    ZStack {
      onDark ? Color.black : ChiefTheme.elevated.opacity(0.45)
      HStack(spacing: 8) {
        MatrixLoader(size: 12)
        Text("Opening browser…")
          .font(.system(size: 12))
      }
      .foregroundStyle(onDark ? Color.white.opacity(0.7) : ChiefTheme.secondary)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Opening browser")
  }
}

/// The browser taken over on this phone, built from browser-ui's controls:
/// back to the conversation and the site, centred, up top; the page takes
/// touches; ending the session, sound and the keyboard sit within thumb's
/// reach below it.
private struct MachineBrowserTakeover: View {
  let driver: BrowserStreamDriver
  let operating: Bool
  @Binding var isPresented: Bool
  let end: @MainActor () async -> Void

  var body: some View {
    VStack(spacing: 0) {
      // The site centres on the screen, not between the buttons.
      ZStack {
        Text(siteName(driver.url) ?? "Browser")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(.white.opacity(0.8))
          .lineLimit(1)
          .padding(.horizontal, 56)
        HStack {
          Button {
            isPresented = false
          } label: {
            Image(systemName: "chevron.down")
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(.white)
              .frame(width: 36, height: 36)
              .background(.black.opacity(0.58), in: Circle())
          }
          .accessibilityLabel("Return to the conversation")
          Spacer()
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 6)

      BrowserStreamView(driver: driver, interactive: true) { OpeningBrowser(onDark: true) }
        // Shown, but never in the way: here the person has the page.
        .overlay {
          if operating {
            BrowserOperatingOverlay(label: driver.activityLabel ?? "Working in this browser")
              .allowsHitTesting(false)
              .transition(.opacity)
          }
        }
        .animation(.easeOut(duration: 0.25), value: operating)

      HStack(spacing: 10) {
        BrowserEndSessionButton { await end() }
        Spacer()
        BrowserStreamSoundButton(driver: driver)
        BrowserStreamKeyboardButton(driver: driver)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
    }
    .background(Color.black.ignoresSafeArea())
  }
}

// MARK: - Automation

/// An automation an agent showed in chat. It's a reference: the card reads
/// the automation itself, so it's always current.
struct AutomationMessageComponent: View {
  @Environment(AppModel.self) private var model
  let component: MessageComponent
  @State private var schedule: WorkspaceSchedule?
  @State private var missing = false
  @State private var showsDetail = false

  private var automationID: String { component.payload["automationId"] ?? "" }

  var body: some View {
    Button {
      guard schedule != nil else { return }
      Haptics.medium()
      showsDetail = true
    } label: {
      CompactChatCard(
        symbol: "bolt.horizontal",
        title: schedule?.title ?? component.payload["title"] ?? "Automation",
        detail: missing ? "No longer available" : schedule.map(statusText) ?? "Loading…"
      ) {
        if schedule != nil {
          Image(systemName: "chevron.right")
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.tertiary)
        }
      }
    }
    .buttonStyle(.plain)
    .task(id: automationID) { await load() }
    .sheet(isPresented: $showsDetail) {
      if let schedule {
        NavigationStack {
          AutomationDetailView(schedule: schedule) { self.schedule = $0 }
        }
      }
    }
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    do {
      let schedules = try await model.relay.schedules(workspaceID: workspaceID)
      schedule = schedules.first { $0.id == automationID }
      missing = schedule == nil
    } catch {
      missing = true
    }
  }

  private func statusText(_ schedule: WorkspaceSchedule) -> String {
    switch schedule.status {
    case "active": "On"
    case "paused": "Paused"
    case "draft", "needs_approval": "Draft"
    default: schedule.status.capitalized
    }
  }
}

// MARK: - Database

/// A workspace database an agent showed in chat, as its table or board.
struct DatabaseMessageComponent: View {
  @Environment(AppModel.self) private var model
  let component: MessageComponent
  @State private var contents: WorkspaceDatabaseWithRows?
  @State private var missing = false
  @State private var showsDatabase = false

  private var databaseID: String { component.payload["databaseId"] ?? "" }
  private var isBoard: Bool { component.payload["view"] == "board" }

  var body: some View {
    Button {
      guard contents != nil else { return }
      Haptics.medium()
      showsDatabase = true
    } label: {
      VStack(alignment: .leading, spacing: 0) {
        CompactChatCard(
          symbol: isBoard ? "rectangle.split.3x1" : "tablecells",
          title: contents?.database.name ?? component.payload["title"] ?? "Database",
          detail: detail
        ) {
          if contents != nil {
            Image(systemName: "chevron.right")
              .font(.system(size: 12))
              .foregroundStyle(ChiefTheme.tertiary)
          }
        }
        if let contents, !contents.rows.isEmpty {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(contents.rows.prefix(3)) { row in
              HStack(spacing: 8) {
                Circle().fill(ChiefTheme.tertiary).frame(width: 4, height: 4)
                Text(rowTitle(row, in: contents.database))
                  .font(.system(size: 13))
                  .lineLimit(1)
              }
            }
          }
          .padding(.horizontal, 14)
          .padding(.bottom, 12)
        }
      }
      .chatCardBackground()
    }
    .buttonStyle(.plain)
    .task(id: databaseID) { await load() }
    .sheet(isPresented: $showsDatabase) {
      if let contents {
        NavigationStack {
          DatabaseSheet(contents: contents, showsBoard: isBoard && contents.database.isBoard)
        }
      }
    }
  }

  private var detail: String {
    if missing { return "No longer available" }
    guard let contents else { return "Loading…" }
    let count = contents.rows.count
    return "\(count) \(count == 1 ? "row" : "rows")"
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    do {
      contents = try await model.relay.database(workspaceID: workspaceID, databaseID: databaseID)
    } catch {
      missing = true
    }
  }
}

private func rowTitle(_ row: WorkspaceDatabaseRow, in database: WorkspaceDatabase) -> String {
  for field in database.fields where field.type == "title" || field.type == "text" {
    if case .string(let text)? = row.values[field.id], !text.isEmpty { return text }
  }
  return "Untitled"
}

private func cellText(_ value: JSONValue?, field: WorkspaceDatabase.Field) -> String? {
  switch value {
  case .string(let text)?:
    if field.type == "select" {
      return field.options?.first { $0.id == text }?.name ?? text
    }
    return text.isEmpty ? nil : text
  case .number(let number)?:
    return number.rounded() == number ? String(Int(number)) : String(number)
  case .bool(let flag)?:
    return flag ? "Yes" : "No"
  case .array(let values)?:
    let texts = values.compactMap { value -> String? in
      if case .string(let text) = value {
        return field.options?.first { $0.id == text }?.name ?? text
      }
      return nil
    }
    return texts.isEmpty ? nil : texts.joined(separator: ", ")
  default:
    return nil
  }
}

private struct DatabaseSheet: View {
  @Environment(\.dismiss) private var dismiss
  let contents: WorkspaceDatabaseWithRows
  let showsBoard: Bool

  var body: some View {
    Group {
      if showsBoard {
        BoardView(database: contents.database)
          .padding(.top, 12)
      } else {
        List(contents.rows) { row in
          VStack(alignment: .leading, spacing: 4) {
            Text(rowTitle(row, in: contents.database))
              .font(.system(size: 15, weight: .medium))
            let details = contents.database.fields
              .filter { $0.type != "title" }
              .compactMap { field in cellText(row.values[field.id], field: field).map { "\(field.name): \($0)" } }
            if !details.isEmpty {
              Text(details.joined(separator: " · "))
                .font(.system(size: 12))
                .foregroundStyle(ChiefTheme.secondary)
                .lineLimit(3)
            }
          }
          .padding(.vertical, 4)
        }
        .listStyle(.plain)
      }
    }
    .navigationTitle(contents.database.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Done") { dismiss() }
      }
    }
  }
}

// MARK: - Draft

/// An email or message an agent drafted for the person to send themselves.
/// Nothing is sent from the card.
struct DraftMessageComponent: View {
  let component: MessageComponent
  @State private var expanded = false
  @State private var copied = false

  private var isEmail: Bool { component.payload["format"] == "email" }
  private var to: String? { component.payload["to"].flatMap { $0.isEmpty ? nil : $0 } }
  private var subject: String? { component.payload["subject"].flatMap { $0.isEmpty ? nil : $0 } }
  private var draftBody: String { component.payload["body"] ?? "" }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Text(isEmail ? "Email draft" : "Message draft")
          .font(.system(size: 13, weight: .medium))
        Spacer(minLength: 8)
        Button(copied ? "Copied" : "Copy") { copy() }
          .buttonStyle(.bordered)
          .controlSize(.small)
        if isEmail, let mail = mailURL {
          Link("Open in Mail", destination: mail)
            .buttonStyle(.bordered)
            .controlSize(.small)
        } else {
          ShareLink(item: draftBody) { Text("Share") }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
      }
      if to != nil || subject != nil {
        VStack(alignment: .leading, spacing: 4) {
          if let to { field("To", to) }
          if let subject { field("Subject", subject) }
        }
      }
      Text(draftBody)
        .font(.system(size: 14))
        .lineLimit(expanded ? nil : 8)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
      if draftBody.count > 400 {
        Button(expanded ? "Show less" : "Show more") { expanded.toggle() }
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
      }
    }
    .padding(14)
    .chatCardBackground()
  }

  private func field(_ label: String, _ value: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text(label)
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.tertiary)
        .frame(width: 52, alignment: .leading)
      Text(value)
        .font(.system(size: 13))
        .lineLimit(2)
    }
  }

  private var mailURL: URL? {
    var parts = URLComponents()
    parts.scheme = "mailto"
    parts.path = to ?? ""
    parts.queryItems = [
      subject.map { URLQueryItem(name: "subject", value: $0) },
      URLQueryItem(name: "body", value: draftBody),
    ].compactMap { $0 }
    return parts.url
  }

  private func copy() {
    UIPasteboard.general.string =
      [subject.map { "Subject: \($0)\n" }, draftBody].compactMap { $0 }.joined(separator: "\n")
    Haptics.medium()
    copied = true
    Task {
      try? await Task.sleep(for: .seconds(1.5))
      copied = false
    }
  }
}

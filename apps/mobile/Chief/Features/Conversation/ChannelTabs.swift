import SwiftUI

/// An artifact kept open as a tab in a channel.
struct ChannelTab: Codable, Hashable, Sendable {
  enum Kind: String, Codable, Sendable { case file, database }

  let kind: Kind
  let id: String
  /// The name when the tab was opened, so the next launch can label it at once.
  var name: String?

  static func == (left: Self, right: Self) -> Bool { left.kind == right.kind && left.id == right.id }
  func hash(into hasher: inout Hasher) {
    hasher.combine(kind)
    hasher.combine(id)
  }
}

/// What a channel shows: its messages, its artifacts, or one artifact opened from them.
enum ChannelView: Hashable {
  case messages, artifacts
  case tab(ChannelTab)
}

/// The artifacts open in each channel's tab strip. A tab stays until it's
/// closed and, as on desktop, is remembered per channel across launches.
enum ChannelTabStore {
  private static let limit = 24

  static func tabs(_ channelID: String, workspaceID: String?) -> [ChannelTab] {
    guard let data = UserDefaults.standard.data(forKey: key(channelID, workspaceID)) else {
      return []
    }
    return (try? JSONDecoder().decode([ChannelTab].self, from: data)) ?? []
  }

  static func save(_ tabs: [ChannelTab], for channelID: String, workspaceID: String?) {
    let key = key(channelID, workspaceID)
    guard !tabs.isEmpty else { return UserDefaults.standard.removeObject(forKey: key) }
    let data = try? JSONEncoder().encode(Array(tabs.suffix(limit)))
    UserDefaults.standard.set(data, forKey: key)
  }

  /// Channel ids such as "general" repeat across workspaces, so tabs are kept
  /// per workspace as well as per channel.
  private static func key(_ channelID: String, _ workspaceID: String?) -> String {
    "chief.channel-tabs:\(workspaceID ?? ""):\(channelID)"
  }
}

/// The channel's views as small text tabs under its header, the active one
/// underlined, as on desktop. Opened artifacts follow the divider, each with
/// a close button; boards assigned to the channel are always there.
struct ChannelViewTabs: View {
  struct Item: Identifiable {
    let tab: ChannelTab
    let name: String
    let symbol: String
    let closable: Bool
    var id: ChannelTab { tab }
  }

  let selection: ChannelView
  let items: [Item]
  let select: (ChannelView) -> Void
  let close: (ChannelTab) -> Void

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 4) {
          viewTab("Messages", view: .messages)
          viewTab("Artifacts", view: .artifacts)
          if !items.isEmpty {
            Rectangle()
              .fill(ChiefTheme.line)
              .frame(width: 0.5)
              .padding(.vertical, 12)
          }
          ForEach(items) { artifactTab($0) }
        }
        .padding(.horizontal, ChiefTheme.pagePadding - 10)
      }
      .onChange(of: selection) { _, selection in
        guard case .tab(let tab) = selection else { return }
        withAnimation(.snappy) { proxy.scrollTo(tab) }
      }
    }
    .frame(height: 40)
    .background(ChiefTheme.background)
    .overlay(alignment: .bottom) {
      Rectangle().fill(ChiefTheme.line).frame(height: 0.5)
    }
  }

  private func viewTab(_ label: String, view: ChannelView) -> some View {
    let selected = selection == view
    return Button {
      choose(view)
    } label: {
      Text(label)
        .tabLabel(selected: selected)
    }
    .buttonStyle(.plain)
    .overlay(alignment: .bottom) {
      if selected { underline }
    }
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private func artifactTab(_ item: Item) -> some View {
    let selected = selection == .tab(item.tab)
    return HStack(spacing: 0) {
      Button {
        choose(.tab(item.tab))
      } label: {
        HStack(spacing: 6) {
          Image(systemName: item.symbol)
            .font(.system(size: 11))
          Text(item.name)
            .frame(maxWidth: 176, alignment: .leading)
        }
        .tabLabel(selected: selected, trailing: selected && item.closable ? 4 : 10)
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(selected ? .isSelected : [])
      // Like desktop, a tab shows its close button once it's the one open.
      if selected && item.closable {
        Button {
          Haptics.light()
          close(item.tab)
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(ChiefTheme.secondary)
            .frame(width: 22, height: 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.trailing, 4)
        .accessibilityLabel("Close \(item.name)")
      }
    }
    .overlay(alignment: .bottom) {
      if selected { underline }
    }
    .contextMenu {
      if item.closable {
        Button("Close", systemImage: "xmark") { close(item.tab) }
      }
    }
    .id(item.tab)
  }

  private var underline: some View {
    Rectangle()
      .fill(.primary)
      .frame(height: 1)
      .padding(.horizontal, 10)
  }

  private func choose(_ view: ChannelView) {
    guard selection != view else { return }
    Haptics.selection()
    select(view)
  }
}

private extension View {
  func tabLabel(selected: Bool, trailing: CGFloat = 10) -> some View {
    font(.system(size: 13))
      .lineLimit(1)
      .foregroundStyle(selected ? Color.primary : ChiefTheme.secondary)
      .padding(.leading, 10)
      .padding(.trailing, trailing)
      .frame(maxHeight: .infinity)
      .contentShape(Rectangle())
  }
}

import SwiftUI

struct ChiefTabBar: View {
  @Binding var selection: WorkspaceTab
  /// The pager's position in pages; each label brightens as its page nears.
  var progress: CGFloat
  let unreadCount: Int

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 20) {
          tab(.home, "Home")
          tab(.inbox, "Inbox", badge: unreadCount)
          tab(.boards, "Boards")
          tab(.automations, "Automations")
          tab(.agents, "Agents")
          tab(.plugins, "Plugins")
          tab(.repositories, "Repositories")
          tab(.artifacts, "Artifacts")
        }
        .padding(.horizontal, 2)
      }
      .onAppear { proxy.scrollTo(selection, anchor: .center) }
      // Follow the nearest page mid-drag, so the active label is centred
      // before the page settles rather than left off-screen.
      .onChange(of: nearest) { _, tab in
        withAnimation(.snappy(duration: 0.3)) { proxy.scrollTo(tab, anchor: .center) }
      }
    }
  }

  private var nearest: WorkspaceTab {
    let tabs = WorkspaceTab.allCases
    return tabs[min(max(Int(progress.rounded()), 0), tabs.count - 1)]
  }

  private func emphasis(of tab: WorkspaceTab) -> Double {
    let index = CGFloat(WorkspaceTab.allCases.firstIndex(of: tab) ?? 0)
    return Double(max(0, 1 - abs(progress - index)))
  }

  private func tab(_ tab: WorkspaceTab, _ label: String, badge: Int = 0) -> some View {
    Button {
      Haptics.selection()
      selection = tab
    } label: {
      HStack(spacing: 6) {
        Text(label)
          .font(.system(size: 16, weight: .semibold))
          .tracking(-0.2)
        if badge > 0 {
          Text(badge > 99 ? "99+" : "\(badge)")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(ChiefTheme.onPrimary)
            .padding(.horizontal, 5)
            .frame(minWidth: 18, minHeight: 18)
            .background(ChiefTheme.primary, in: Capsule())
        }
      }
      // Each label brightens as its page scrolls in, so the highlight
      // follows a drag instead of jumping when the page settles.
      .foregroundStyle(ChiefTheme.tertiary.mix(with: .primary, by: emphasis(of: tab)))
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .id(tab)
    .accessibilityLabel(label)
    .accessibilityAddTraits(selection == tab ? [.isSelected] : [])
  }
}


import SwiftUI

struct ChiefTabBar: View {
  @Binding var selection: WorkspaceTab
  let unreadCount: Int

  var body: some View {
    HStack(spacing: 4) {
      tab(.home, "Home", "house.fill", badge: unreadCount)
      tab(.plugins, "Plugins", "puzzlepiece.extension.fill")
      tab(.projects, "Projects", "shippingbox")
      tab(.agents, "Agents", "person.2.fill")
    }
    .padding(6)
    .frame(maxWidth: 380, minHeight: 62)
    .background(ChiefTheme.surface.opacity(0.85), in: Capsule())
    .background(.regularMaterial, in: Capsule())
    .overlay { Capsule().stroke(ChiefTheme.line, lineWidth: 0.5) }
    .shadow(color: .black.opacity(0.14), radius: 10, y: 4)
  }

  private func tab(_ tab: WorkspaceTab, _ label: String, _ icon: String, badge: Int = 0)
    -> some View
  {
    Button {
      Haptics.selection()
      selection = tab
    } label: {
      VStack(spacing: 3) {
        ZStack(alignment: .topTrailing) {
          Image(systemName: icon)
            .font(.system(size: 18, weight: selection == tab ? .semibold : .regular))
          if badge > 0 && tab == .home {
            Text(badge > 99 ? "99+" : "\(badge)")
              .font(.system(size: 9, weight: .bold))
              .foregroundStyle(.black)
              .padding(.horizontal, 4)
              .frame(minWidth: 16, minHeight: 16)
              .background(.white, in: Capsule())
              .offset(x: 12, y: -7)
          }
        }
        Text(label).font(.system(size: 10.5, weight: selection == tab ? .semibold : .medium))
      }
      .foregroundStyle(selection == tab ? Color.white : ChiefTheme.secondary)
      .frame(maxWidth: .infinity, minHeight: 50)
      .background(
        selection == tab ? ChiefTheme.elevated : .clear,
        in: Capsule()
      )
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
    .accessibilityAddTraits(selection == tab ? [.isSelected] : [])
  }
}


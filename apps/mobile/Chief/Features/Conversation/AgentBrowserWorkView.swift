import BrowserUI
import BrowserUIWebKit
import SwiftUI

struct AgentBrowserWorkView: View {
  let workspaceID: String
  let conversationIDs: [String]
  let agents: [AgentActivityPresence]

  var body: some View {
    if !browsers.isEmpty {
      ScrollView(.horizontal, showsIndicators: false) {
        LazyHStack(spacing: 10) {
          ForEach(browsers, id: \.agent.id) { presence in
            LiveAgentBrowserCard(presence: presence)
              .containerRelativeFrame(.horizontal)
          }
        }
        .scrollTargetLayout()
      }
      .contentMargins(.horizontal, ChiefTheme.pagePadding, for: .scrollContent)
      .scrollTargetBehavior(.viewAligned(limitBehavior: .always))
      .padding(.vertical, 8)
      .background(ChiefTheme.surface.opacity(0.45))
    }
  }

  private var browsers: [AgentBrowserPresence] {
    agents.compactMap { agent in
      for conversationID in conversationIDs {
        let scope = "\(workspaceID):\(agent.id):\(conversationID)"
        if let driver = AgentBrowserSession.existingDriver(for: scope), driver.isEngaged {
          return AgentBrowserPresence(agent: agent, driver: driver)
        }
      }
      return nil
    }
  }
}

@MainActor
private struct AgentBrowserPresence {
  let agent: AgentActivityPresence
  let driver: WebKitBrowserDriver
}

@MainActor
private struct LiveAgentBrowserCard: View {
  let presence: AgentBrowserPresence
  @State private var showsTakeover = false

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack(spacing: 7) {
        MatrixLoader(size: 13)
          .foregroundStyle(ChiefTheme.agentColor(presence.agent.id))
        Text("\(presence.agent.name) is browsing")
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(ChiefTheme.secondary)
        Spacer(minLength: 0)
        Image(systemName: "arrow.up.left.and.arrow.down.right")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      WebKitBrowserView(
        driver: presence.driver,
        revision: presence.driver.surfaceRevision,
        presentationMode: .preview,
        displayMode: .inline
      )
      .aspectRatio(16 / 10, contentMode: .fit)
      .background(.black)
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(ChiefTheme.line)
      }
      .overlay {
        if presence.driver.operating {
          BrowserOperatingOverlay(
            label: presence.driver.activity?.label
              ?? presence.driver.lastActionLabel
              ?? "Browsing"
          )
        }
      }
      .contentShape(Rectangle())
      .onTapGesture {
        Haptics.medium()
        showsTakeover = true
      }
    }
    .fullScreenCover(isPresented: $showsTakeover) {
      ZStack {
        WebKitBrowserView(
          driver: presence.driver,
          revision: presence.driver.surfaceRevision,
          presentationMode: .takeover,
          displayMode: .inline
        )
        .ignoresSafeArea()
        if presence.driver.operating {
          BrowserOperatingOverlay(
            label: presence.driver.activity?.label
              ?? presence.driver.lastActionLabel
              ?? "Agent is operating this browser"
          )
          .ignoresSafeArea()
        }
      }
      .overlay(alignment: .topTrailing) {
        Button {
          showsTakeover = false
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 38, height: 38)
            .background(.black.opacity(0.58), in: Circle())
        }
        .padding(16)
        .accessibilityLabel("Close browser")
      }
      .task { await presence.driver.enterTakeoverViewport() }
      .onDisappear { Task { await presence.driver.restoreDesktopViewport() } }
    }
  }
}

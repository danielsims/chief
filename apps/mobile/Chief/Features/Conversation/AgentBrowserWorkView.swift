import BrowserUI
import BrowserUIWebKit
import SwiftUI
import UIKit

/// Hosts live browser sessions in one of BrowserUI's two preview placements.
/// Each card owns the exact workspace-agent-conversation scope that created it;
/// changing placement reparents the same WKWebView rather than creating a copy.
struct AgentBrowserWorkView: View {
  let workspaceID: String
  let conversationIDs: [String]
  let agents: [AgentActivityPresence]
  let placement: BrowserDisplayMode
  @ObservedObject private var presentation = AgentBrowserSession.presentation

  init(
    workspaceID: String,
    conversationIDs: [String],
    agents: [AgentActivityPresence],
    placement: BrowserDisplayMode = .pictureInPicture
  ) {
    self.workspaceID = workspaceID
    self.conversationIDs = conversationIDs
    self.agents = agents
    self.placement = placement
  }

  var body: some View {
    let _ = presentation.revision
    if !browsers.isEmpty {
      if placement == .pictureInPicture {
        pictureInPictureBrowsers
      } else {
        inlineBrowsers
      }
    }
  }

  private var pictureInPictureBrowsers: some View {
    VStack(spacing: 10) {
      browserCards
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 10)
    .padding(.top, 8)
    .padding(.bottom, 6)
  }

  private var inlineBrowsers: some View {
    VStack(spacing: 16) {
      browserCards
    }
    .frame(maxWidth: .infinity)
  }

  @ViewBuilder
  private var browserCards: some View {
    ForEach(browsers, id: \.scope) { presence in
      ScopedAgentBrowserCard(presence: presence, placement: placement)
    }
  }

  private var browsers: [AgentBrowserPresence] {
    agents.compactMap { agent in
      for conversationID in conversationIDs {
        let scope = "\(workspaceID):\(agent.id):\(conversationID)"
        if let driver = AgentBrowserSession.existingDriver(for: scope),
          AgentBrowserSession.shouldPresent(driver, for: scope, placement: placement)
        {
          return AgentBrowserPresence(scope: scope, driver: driver)
        }
      }
      return nil
    }
  }
}

@MainActor
private struct AgentBrowserPresence {
  let scope: String
  let driver: WebKitBrowserDriver
}

@MainActor
private struct ScopedAgentBrowserCard: View {
  let presence: AgentBrowserPresence
  let placement: BrowserDisplayMode
  @ObservedObject private var driver: WebKitBrowserDriver

  init(presence: AgentBrowserPresence, placement: BrowserDisplayMode) {
    self.presence = presence
    self.placement = placement
    _driver = ObservedObject(wrappedValue: presence.driver)
  }

  var body: some View {
    if AgentBrowserSession.shouldPresent(
      driver,
      for: presence.scope,
      placement: placement
    ) {
      LiveAgentBrowserCard(
        scope: presence.scope,
        driver: driver,
        operating: true
      )
      .frame(maxWidth: .infinity)
      .padding(.vertical, placement == .pictureInPicture ? 0 : 2)
    }
  }
}

@MainActor
private struct LiveAgentBrowserCard: View {
  let scope: String
  @ObservedObject var driver: WebKitBrowserDriver
  let operating: Bool
  @State private var showsTakeover = false
  @State private var openingTakeover = false
  @State private var takeoverReady = false
  @State private var returningToPreview = false
  @State private var frozenDesktopFrame: UIImage?

  private var activeOperatingLabel: String {
    AgentBrowserSession.operationLabel(for: scope)
      ?? driver.activity?.label
      ?? driver.lastActionLabel
      ?? "Agent is operating this browser"
  }

  var body: some View {
    BrowserFrame {
      browserPage
    }
    .frame(maxWidth: .infinity)
    .overlay {
      Button {
        openTakeover()
      } label: {
        Color.clear
          .contentShape(Rectangle())
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Open browser full screen")
      .accessibilityHint("Take over and interact with the current page")
    }
    .overlay(alignment: .topTrailing) {
      BrowserPictureInPictureButton(
        active: driver.displayMode == .pictureInPicture
      ) {
        Haptics.medium()
        let next: BrowserDisplayMode =
          driver.displayMode == .pictureInPicture ? .inline : .pictureInPicture
        AgentBrowserSession.setDisplayMode(next, for: scope)
      }
      .padding(14)
    }
    .fullScreenCover(isPresented: $showsTakeover, onDismiss: {
      Task { @MainActor in
        await finishReturningToPreview()
      }
    }) {
      takeover
    }
  }

  private var browserPage: some View {
    Group {
      if case .failed(let message) = driver.phase {
        VStack(spacing: 10) {
          Image(systemName: "exclamationmark.triangle")
            .font(.system(size: 22, weight: .medium))
            .foregroundStyle(.red)
          Text(message)
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
      } else {
        WebKitBrowserView(
          driver: driver,
          revision: driver.surfaceRevision,
          presentationMode: .preview,
          displayMode: driver.displayMode
        )
      }
    }
    .frame(maxWidth: .infinity)
    .aspectRatio(16 / 10, contentMode: .fit)
    .background(.black)
    .overlay {
      operatingOverlay
    }
    .overlay {
      if let cursor = driver.cursor, cursor.visible {
        BrowserAgentCursor(
          state: cursor,
          containedViewport: driver.configuration.desktopViewportSize
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .zIndex(2)
      }
    }
    .overlay {
      if returningToPreview {
        frozenPreview
      }
    }
  }

  private var takeover: some View {
    ZStack {
      WebKitBrowserView(
        driver: driver,
        revision: driver.surfaceRevision,
        presentationMode: .takeover,
        displayMode: driver.displayMode
      )
      .ignoresSafeArea()

      operatingOverlay
        .ignoresSafeArea()

      if let cursor = driver.cursor, cursor.visible {
        BrowserAgentCursor(state: cursor)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .zIndex(2)
      }

      frozenPreview
        .background(.black)
        .ignoresSafeArea()
        .opacity(takeoverReady ? 0 : 1)
        .allowsHitTesting(false)
    }
    .overlay(alignment: .topTrailing) {
      Button {
        closeTakeover()
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
    .task {
      await driver.enterTakeoverViewport()
      withAnimation(.easeOut(duration: 0.16)) {
        takeoverReady = true
      }
    }
  }

  @ViewBuilder
  private var operatingOverlay: some View {
    if operating {
      BrowserOperatingOverlay(
        label: activeOperatingLabel,
        variant: .prism
      )
      .allowsHitTesting(false)
    }
  }

  @ViewBuilder
  private var frozenPreview: some View {
    if let frozenDesktopFrame {
      Image(uiImage: frozenDesktopFrame)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black)
    } else {
      Color.black
    }
  }

  private func openTakeover() {
    guard !showsTakeover, !openingTakeover else { return }
    Haptics.medium()
    openingTakeover = true
    Task { @MainActor in
      frozenDesktopFrame = await driver.captureTransitionFrame()
      takeoverReady = false
      showsTakeover = true
      openingTakeover = false
    }
  }

  private func closeTakeover() {
    guard showsTakeover else { return }
    withAnimation(.easeIn(duration: 0.12)) {
      takeoverReady = false
    }
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(120))
      returningToPreview = true
      showsTakeover = false
    }
  }

  private func finishReturningToPreview() async {
    await driver.restoreDesktopViewport()
    withAnimation(.easeOut(duration: 0.14)) {
      returningToPreview = false
    }
    try? await Task.sleep(for: .milliseconds(150))
    frozenDesktopFrame = nil
  }
}

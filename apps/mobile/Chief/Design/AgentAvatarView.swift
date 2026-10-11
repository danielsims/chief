import SwiftUI
import UIKit

extension EnvironmentValues {
  /// Agent avatars by agent id and lowercased name, set once at the app root.
  @Entry var agentAvatars: [String: AgentAvatar] = [:]
  /// Provider logo asset names for on-device agents without an avatar.
  @Entry var agentProviderLogos: [String: String] = [:]
}

/// An on-device agent's provider logo on its brand-coloured tile, as on
/// desktop: Claude's white mark on orange, the others on white.
struct AgentProviderLogoView: View {
  let asset: String
  let size: CGFloat

  private var isClaude: Bool { asset == "ProviderClaude" }

  var body: some View {
    Image(asset)
      .resizable()
      .renderingMode(isClaude ? .template : .original)
      .scaledToFit()
      .foregroundStyle(Color.white)
      .padding(size * 0.2)
      .frame(width: size, height: size)
      .background(
        isClaude ? Color(red: 0.851, green: 0.467, blue: 0.341) : Color.white,
        in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
          .stroke(Color.black.opacity(0.08), lineWidth: 0.5)
      }
  }
}

/// Draws an agent's own avatar inside the same rounded tile as `AgentMark`.
struct AgentAvatarView: View {
  let avatar: AgentAvatar
  let size: CGFloat

  var body: some View {
    switch avatar {
    case .image(let url):
      AsyncImage(url: url) { image in
        image.resizable().scaledToFill()
      } placeholder: {
        ChiefTheme.elevated
      }
      .frame(width: size, height: size)
      .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    case .sprite(let url, let columns, let rows, let frames, let fps):
      AgentSpriteView(
        url: url,
        columns: columns,
        rows: rows,
        frames: frames,
        fps: fps,
        size: size
      )
      .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    case .style(let color, let shape, let glyph):
      ZStack {
        shapeView(shape).fill(Color(hex: color) ?? ChiefTheme.elevated)
        if let glyph {
          Text(glyph)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(Color.black.opacity(0.88))
        } else {
          Image(systemName: "viewfinder")
            .font(.system(size: size * 0.48, weight: .semibold))
            .foregroundStyle(Color.black.opacity(0.88))
        }
      }
      .frame(width: size, height: size)
    }
  }

  private func shapeView(_ shape: AgentAvatar.Shape) -> AnyShape {
    switch shape {
    case .circle: AnyShape(Circle())
    case .rounded: AnyShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    case .square: AnyShape(RoundedRectangle(cornerRadius: size * 0.14, style: .continuous))
    }
  }
}

/// Loops a sprite sheet's first frames as an idle animation, holding the first
/// frame when Reduce Motion is on.
private struct AgentSpriteView: View {
  let url: URL
  let columns: Int
  let rows: Int
  let frames: Int
  let fps: Int
  let size: CGFloat
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var sheet: UIImage?

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / Double(max(fps, 1)), paused: reduceMotion || frames < 2)) { context in
      let frame = reduceMotion ? 0 : Int(context.date.timeIntervalSinceReferenceDate * Double(fps)) % max(frames, 1)
      ZStack(alignment: .topLeading) {
        if let sheet {
          Image(uiImage: sheet)
            .resizable()
            .interpolation(.none)
            .frame(width: size * CGFloat(columns), height: size * CGFloat(rows))
            .offset(
              x: -size * CGFloat(frame % columns),
              y: -size * CGFloat(frame / columns)
            )
        } else {
          ChiefTheme.elevated
        }
      }
      .frame(width: size, height: size, alignment: .topLeading)
      .clipped()
    }
    .task(id: url) { sheet = await SpriteSheetCache.shared.image(for: url) }
  }
}

/// Keeps decoded sprite sheets in memory so every avatar on screen shares one.
private actor SpriteSheetCache {
  static let shared = SpriteSheetCache()
  private var images: [URL: UIImage] = [:]

  func image(for url: URL) async -> UIImage? {
    if let cached = images[url] { return cached }
    guard let (data, _) = try? await URLSession.shared.data(from: url),
      let image = UIImage(data: data)
    else { return nil }
    images[url] = image
    return image
  }
}

private extension Color {
  init?(hex: String) {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
    self.init(
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255
    )
  }
}

import SwiftUI
import UIKit
import WebKit

/// Mirrors the desktop Plugins page logo policy: preserve logos that already
/// carry their own colored background, give transparent dark logos a light
/// backing when required, and place Google's multicolor mark on white.
enum BrandLogoPolicy {
  static func isGoogle(domain: String) -> Bool {
    domain == "google.com"
      || domain == "workspace.google.com"
      || domain == "analytics.googleapis.com"
      || domain == "googleads.googleapis.com"
      || domain.hasSuffix(".googleapis.com")
  }

  /// True when a transparent, dark logo would disappear against the app's
  /// dark surface and needs a light backing. Same thresholds as the desktop
  /// `needsLightBacking` heuristic (coverage < 0.62, luminance/visible < 150).
  static func needsLightBacking(_ image: UIImage) -> Bool {
    let size = CGSize(width: 32, height: 32)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    let bitmap = renderer.image { context in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let cgImage = bitmap.cgImage,
      let data = cgImage.dataProvider?.data,
      let bytes = CFDataGetBytePtr(data)
    else { return true }
    let width = cgImage.width
    let height = cgImage.height
    let bytesPerPixel = max(4, cgImage.bitsPerPixel / 8)
    var visible = 0
    var luminance = 0
    for y in 0..<height {
      for x in 0..<width {
        let offset = y * cgImage.bytesPerRow + x * bytesPerPixel
        let alpha = bytes[offset + 3]
        if alpha < 32 { continue }
        visible += 1
        luminance += Int(
          0.2126 * Double(bytes[offset])
            + 0.7152 * Double(bytes[offset + 1])
            + 0.0722 * Double(bytes[offset + 2])
        )
      }
    }
    if visible == 0 { return false }
    let coverage = Double(visible) / Double(width * height)
    return coverage < 0.62 && Double(luminance) / Double(visible) < 150
  }
}

/// Integrations.sh sometimes wraps a PNG in an SVG. Decode that raster
/// directly so Granola is never a WebView snapshot of a different logo.
enum BrandLogoSVG {
  static func embeddedRasterImage(in data: Data) -> UIImage? {
    guard let markup = String(data: data, encoding: .utf8) else { return nil }
    for prefix in [
      "data:image/png;base64,",
      "data:image/jpeg;base64,",
      "data:image/webp;base64,",
    ] {
      guard let start = markup.range(of: prefix)?.upperBound else { continue }
      let encoded = markup[start...].prefix {
        $0 != "\"" && !$0.isWhitespace && $0 != "'"
      }
      var payload = String(encoded)
      let pad = payload.count % 4
      if pad != 0 { payload += String(repeating: "=", count: 4 - pad) }
      guard let decoded = Data(base64Encoded: payload),
        let image = UIImage(data: decoded)
      else { continue }
      return image
    }
    return nil
  }
}

/// Rasterizes a provider logo. Raster assets decode directly; remaining SVG
/// logos render one at a time through an offscreen WebView so parallel
/// onboarding prefetch cannot snapshot Sentry into Granola's cache slot.
@MainActor
enum BrandLogoImage {
  private static var imageCache: [String: UIImage] = [:]
  private static var rasterizeChain: Task<UIImage?, Never>?

  static func load(url: URL) async -> UIImage? {
    if let cached = imageCache[url.absoluteString] { return cached }
    guard let (data, _) = try? await URLSession.shared.data(from: url),
      !data.isEmpty
    else { return nil }
    if let raster = UIImage(data: data) {
      imageCache[url.absoluteString] = raster
      return raster
    }
    if let embedded = BrandLogoSVG.embeddedRasterImage(in: data) {
      imageCache[url.absoluteString] = embedded
      return embedded
    }
    if let rendered = await rasterizeSVG(data: data) {
      imageCache[url.absoluteString] = rendered
      return rendered
    }
    return nil
  }

  /// Downloads and caches logos up front so grids render instantly with no
  /// per-image flicker when they first appear.
  static func prefetch(urls: [URL]) async {
    await withTaskGroup(of: Void.self) { group in
      for url in urls {
        group.addTask { _ = await load(url: url) }
      }
    }
  }

  private static func rasterizeSVG(data: Data) async -> UIImage? {
    let previous = rasterizeChain
    let task = Task { @MainActor in
      _ = await previous?.value
      return await renderSVG(data: data)
    }
    rasterizeChain = task
    return await task.value
  }

  private static func renderSVG(data: Data) async -> UIImage? {
    guard let markup = String(data: data, encoding: .utf8) else { return nil }
    let webView = makeWebView()
    let html =
      "<html><head><meta name='viewport' content='width=64,initial-scale=1'>"
      + "<style>html,body{margin:0;padding:0;background:transparent;width:64px;height:64px;overflow:hidden}"
      + "svg,img{width:64px;height:64px;display:block;object-fit:contain}</style></head>"
      + "<body>\(markup)</body></html>"
    webView.loadHTMLString(html, baseURL: nil)
    for _ in 0..<60 {
      if !webView.isLoading { break }
      try? await Task.sleep(nanoseconds: 40_000_000)
    }
    try? await Task.sleep(nanoseconds: 80_000_000)
    return await withCheckedContinuation { continuation in
      webView.takeSnapshot(with: nil) { image, _ in
        continuation.resume(returning: image)
      }
    }
  }

  private static func makeWebView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.allowsInlineMediaPlayback = false
    let view = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 64, height: 64),
      configuration: configuration
    )
    view.isOpaque = false
    view.backgroundColor = .clear
    return view
  }
}

/// The OpenCode mark in its light variant: a white glyph meant for dark
/// surfaces directly, without a circular or square backing.
struct OpenCodeMark: View {
  let size: CGFloat

  var body: some View {
    let s = size / 24
    Path { path in
      path.move(to: CGPoint(x: 16 * s, y: 6 * s))
      path.addLine(to: CGPoint(x: 8 * s, y: 6 * s))
      path.addLine(to: CGPoint(x: 8 * s, y: 18 * s))
      path.addLine(to: CGPoint(x: 16 * s, y: 18 * s))
      path.closeSubpath()
      path.move(to: CGPoint(x: 20 * s, y: 22 * s))
      path.addLine(to: CGPoint(x: 4 * s, y: 22 * s))
      path.addLine(to: CGPoint(x: 4 * s, y: 2 * s))
      path.addLine(to: CGPoint(x: 20 * s, y: 2 * s))
      path.closeSubpath()
    }
    .fill(Color.white, style: FillStyle(eoFill: true))
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/// A provider logo rendered with the same backing policy as the desktop
/// Plugins page, sourced from the same catalog URLs.
struct BrandLogoView: View {
  let domain: String
  let iconURL: URL?
  let size: CGFloat

  @State private var image: UIImage?
  @State private var failed = false
  @State private var needsBacking = false

  private static var imageCache: [String: UIImage] = [:]
  private static var backingCache: [String: Bool] = [:]

  private var radius: CGFloat { size * 0.23 }

  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().scaledToFit()
      } else {
        Text(String(domain.prefix(1)).uppercased())
          .font(.system(size: size * 0.38, weight: .bold))
          .foregroundStyle(needsBacking ? .black : .white)
      }
    }
    .frame(width: size, height: size)
    .background(
      needsBacking ? Color.white : Color.clear,
      in: RoundedRectangle(cornerRadius: radius, style: .continuous)
    )
    .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    .task(id: iconURL) { await load() }
    .accessibilityHidden(true)
  }

  private func load() async {
    failed = false
    needsBacking = false
    guard let url = iconURL else {
      failed = true
      needsBacking = true
      return
    }
    let key = url.absoluteString
    if let cached = Self.imageCache[key] {
      image = cached
      needsBacking = Self.backingCache[key] ?? backingPolicy(for: cached)
      return
    }
    guard let loaded = await BrandLogoImage.load(url: url) else {
      failed = true
      needsBacking = true
      return
    }
    Self.imageCache[key] = loaded
    let policy = backingPolicy(for: loaded)
    Self.backingCache[key] = policy
    image = loaded
    needsBacking = policy
  }

  private func backingPolicy(for image: UIImage) -> Bool {
    BrandLogoPolicy.isGoogle(domain: domain) || BrandLogoPolicy.needsLightBacking(image)
  }
}

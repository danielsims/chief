import CryptoKit
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

/// Rasterizes a provider logo. Raster assets decode directly; vector (SVG)
/// logos — Granola and friends — are rendered through an offscreen WebView so
/// they appear the same way they do on the desktop.
@MainActor
enum BrandLogoImage {
  private static var imageCache: [String: UIImage] = [:]
  private static var inFlight: [String: Task<UIImage?, Never>] = [:]

  static func bundled(domain: String) -> UIImage? {
    let canonical = PluginCatalogClient.domainAliases[domain.lowercased()] ?? domain.lowercased()
    return UIImage(named: "Plugin-" + canonical.replacingOccurrences(of: ".", with: "-"))
  }

  static func cached(url: URL) -> UIImage? {
    if let image = imageCache[url.absoluteString] { return image }
    guard let path = cacheURL(url), let image = UIImage(contentsOfFile: path.path) else { return nil }
    imageCache[url.absoluteString] = image
    return image
  }

  static func load(url: URL) async -> UIImage? {
    if let image = cached(url: url) { return image }
    if let task = inFlight[url.absoluteString] { return await task.value }
    let task = Task { @MainActor () -> UIImage? in
      var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
      request.setValue("image/*", forHTTPHeaderField: "Accept")
      guard let (data, response) = try? await URLSession.shared.data(for: request),
        let http = response as? HTTPURLResponse, http.statusCode == 200,
        !data.isEmpty, data.count <= 2_000_000 else { return nil }
      let result: UIImage?
      if let raster = UIImage(data: data) { result = raster }
      else { result = await rasterizeSVG(data: data) }
      guard let result else { return nil }
      imageCache[url.absoluteString] = result
      if let path = cacheURL(url), let png = result.pngData() {
        try? FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? png.write(to: path, options: .atomic)
      }
      return result
    }
    inFlight[url.absoluteString] = task
    let image = await task.value
    inFlight[url.absoluteString] = nil
    return image
  }

  private static func cacheURL(_ url: URL) -> URL? {
    let hash = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
      .appendingPathComponent("PluginLogos", isDirectory: true).appendingPathComponent(hash + ".png")
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
    guard let markup = String(data: data, encoding: .utf8), markup.contains("<svg") else { return nil }
    let webView = makeWebView()
    let html =
      "<html><head><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:;\"><meta name='viewport' content='width=\(64),initial-scale=1'>"
      + "<style>html,body{margin:0;padding:0;background:transparent;width:64px;height:64px;display:flex;align-items:center;justify-content:center;overflow:hidden}svg{width:64px!important;height:64px!important}</style></head>"
      + "<body>\(markup)</body></html>"
    webView.loadHTMLString(html, baseURL: nil)
    for _ in 0..<60 {
      if !webView.isLoading { break }
      try? await Task.sleep(nanoseconds: 40_000_000)
    }
    try? await Task.sleep(nanoseconds: 60_000_000)
    return await withCheckedContinuation { continuation in
      webView.takeSnapshot(with: nil) { image, _ in
        continuation.resume(returning: image)
      }
    }
  }

  private static func makeWebView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.allowsInlineMediaPlayback = false
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 64, height: 64), configuration: configuration)
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
  @State private var needsBacking = false

  init(domain: String, iconURL: URL?, size: CGFloat) {
    self.domain = domain
    self.iconURL = iconURL
    self.size = size
    let initial = BrandLogoImage.bundled(domain: domain) ?? iconURL.flatMap(BrandLogoImage.cached)
    _image = State(initialValue: initial)
    _needsBacking = State(initialValue: initial.map {
      BrandLogoPolicy.isGoogle(domain: domain) || BrandLogoPolicy.needsLightBacking($0)
    } ?? false)
  }

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
    image = BrandLogoImage.bundled(domain: domain)
    if let image {
      needsBacking = backingPolicy(for: image)
      return
    }
    needsBacking = false
    guard let url = iconURL, let loaded = await BrandLogoImage.load(url: url), !Task.isCancelled else { return }
    image = loaded
    needsBacking = backingPolicy(for: loaded)
  }

  private func backingPolicy(for image: UIImage) -> Bool {
    BrandLogoPolicy.isGoogle(domain: domain) || BrandLogoPolicy.needsLightBacking(image)
  }
}

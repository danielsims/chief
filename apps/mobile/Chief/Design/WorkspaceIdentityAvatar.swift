import Observation
import SwiftUI
import UIKit

/// Workspace artwork with the same source order as desktop OrgLogo: an
/// explicit logo, first-party favicon variants, then Google's 64px service.
/// Undersized Google responses are generic globe stubs and are rejected.
struct WorkspaceIdentityAvatar: View {
  let name: String
  let website: String?
  let imageURL: URL?
  let size: CGFloat
  /// Drops the tile so the mark sits directly on the page background.
  var plain = false

  @State private var imageStore = IdentityImageStore.shared

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
        .fill(plain ? ChiefTheme.background : ChiefTheme.elevated)
      // The initial only stands in until a logo loads, so a transparent
      // logo never shows it underneath.
      if let image = imageStore.image(for: identityKey) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        Text(initial)
          .font(.system(size: size * 0.38, weight: .semibold))
          .foregroundStyle(ChiefTheme.accent)
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.27, style: .continuous))
    .overlay {
      if !plain {
        RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
          .stroke(ChiefTheme.line)
      }
    }
    .task(id: identityKey) {
      await imageStore.load(
        key: identityKey,
        candidates: WorkspaceFaviconSource.candidates(website: website, imageURL: imageURL)
      )
    }
    .accessibilityLabel(name)
  }

  private var identityKey: String {
    Self.identityKey(name: name, website: website, imageURL: imageURL)
  }

  private static func identityKey(name: String, website: String?, imageURL: URL?) -> String {
    "\(name)|\(website ?? "")|\(imageURL?.absoluteString ?? "")"
  }

  private var initial: String {
    String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1)).uppercased()
  }

}

/// The first image that loads and is large enough among a mark's candidate
/// sources, kept for the session by the key of what it stands for.
@MainActor
@Observable
final class IdentityImageStore {
  static let shared = IdentityImageStore()
  private var images: [String: UIImage] = [:]
  private var loading = Set<String>()

  func image(for key: String) -> UIImage? {
    images[key]
  }

  /// Decodes an image the relay already sent, once per key. False when it
  /// is not an image this device can show.
  func load(key: String, data: Data) -> Bool {
    if images[key] == nil { images[key] = UIImage(data: data) }
    return images[key] != nil
  }

  func load(key: String, candidates: [WorkspaceFaviconSource.Candidate]) async {
    guard images[key] == nil, loading.insert(key).inserted else { return }
    defer { loading.remove(key) }
    for candidate in candidates {
      guard !Task.isCancelled,
        let loaded = await BrandLogoImage.load(url: candidate.url),
        candidate.accepts(loaded)
      else { continue }
      images[key] = loaded
      return
    }
  }
}

enum WorkspaceFaviconSource {
  struct Candidate {
    let url: URL
    let minimumPixelWidth: Int

    func accepts(_ image: UIImage) -> Bool {
      let pixelWidth = image.cgImage?.width ?? Int(image.size.width * image.scale)
      return pixelWidth >= minimumPixelWidth
    }
  }

  static func candidates(website: String?, imageURL: URL?) -> [Candidate] {
    var values: [Candidate] = []
    if let imageURL {
      values.append(Candidate(url: imageURL, minimumPixelWidth: 1))
    }
    guard let origin = websiteOrigin(website) else { return values }
    values.append(contentsOf: [
      Candidate(url: origin.appending(path: "favicon.ico"), minimumPixelWidth: 16),
      Candidate(url: origin.appending(path: "favicon.svg"), minimumPixelWidth: 16),
      Candidate(url: origin.appending(path: "apple-touch-icon.png"), minimumPixelWidth: 16),
    ])
    if let host = origin.host,
      var google = URLComponents(string: "https://www.google.com/s2/favicons")
    {
      google.queryItems = [
        URLQueryItem(name: "domain", value: host),
        URLQueryItem(name: "sz", value: "64"),
      ]
      if let url = google.url {
        values.append(Candidate(url: url, minimumPixelWidth: 32))
      }
    }
    var seen = Set<URL>()
    return values.filter { seen.insert($0.url).inserted }
  }

  private static func websiteOrigin(_ website: String?) -> URL? {
    guard let website else { return nil }
    let trimmed = website.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty,
      let parsed = URL(string: trimmed.contains("://") ? trimmed : "https://\(trimmed)"),
      let scheme = parsed.scheme?.lowercased(),
      ["http", "https"].contains(scheme),
      parsed.host != nil,
      var components = URLComponents(url: parsed, resolvingAgainstBaseURL: false)
    else { return nil }
    components.path = ""
    components.query = nil
    components.fragment = nil
    components.user = nil
    components.password = nil
    return components.url
  }
}

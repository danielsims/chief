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

  @State private var imageStore = WorkspaceIdentityImageStore.shared

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
        .fill(ChiefTheme.elevated)
      Text(initial)
        .font(.system(size: size * 0.38, weight: .semibold))
        .foregroundStyle(ChiefTheme.accent)
      if let image = imageStore.image(for: identityKey) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: size * 0.27, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
        .stroke(ChiefTheme.line)
    }
    .task(id: identityKey) {
      await imageStore.load(
        identityKey: identityKey,
        website: website,
        imageURL: imageURL
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

@MainActor
@Observable
private final class WorkspaceIdentityImageStore {
  static let shared = WorkspaceIdentityImageStore()
  private var images: [String: UIImage] = [:]
  private var loading = Set<String>()

  func image(for key: String) -> UIImage? {
    images[key]
  }

  func load(identityKey: String, website: String?, imageURL: URL?) async {
    guard images[identityKey] == nil, loading.insert(identityKey).inserted else { return }
    defer { loading.remove(identityKey) }
    for candidate in WorkspaceFaviconSource.candidates(
      website: website,
      imageURL: imageURL
    ) {
      guard !Task.isCancelled,
        let loaded = await BrandLogoImage.load(url: candidate.url),
        candidate.accepts(loaded)
      else { continue }
      images[identityKey] = loaded
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

import Foundation

enum ChiefAccountLinks {
  static let privacy = URL(string: "https://heychief.sh/privacy")!
  static let terms = URL(string: "https://heychief.sh/terms")!
}

enum ChiefCloudAddress {
  static func matches(_ value: String, cloud: AppConfiguration) -> Bool {
    let normalized = value
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return normalized == "heychief.sh"
      || normalized == "https://heychief.sh"
      || normalized == cloud.relayURL.absoluteString.lowercased()
  }
}

import Foundation

/// Prevents an agent or prompt-injected page from turning the on-device
/// browser into a local-network request primitive. BrowserUI invokes this for
/// direct navigation, clicks, script redirects, and new-window navigation.
enum BrowserURLPolicy {
  static func allows(_ url: URL) -> Bool {
    guard url.scheme?.lowercased() == "https",
      url.user == nil,
      url.password == nil,
      let host = url.host?.lowercased(),
      !host.isEmpty,
      host != "localhost",
      !host.hasSuffix(".localhost"),
      !host.hasSuffix(".local"),
      !host.hasSuffix(".internal")
    else { return false }
    return !isPrivateIPv4(host) && !isPrivateIPv6(host)
  }

  private static func isPrivateIPv4(_ host: String) -> Bool {
    let octets = host.split(separator: ".").compactMap { UInt8($0) }
    guard octets.count == 4 else { return false }
    let first = octets[0]
    let second = octets[1]
    return first == 0
      || first == 10
      || first == 127
      || (first == 100 && (64...127).contains(second))
      || (first == 169 && second == 254)
      || (first == 172 && (16...31).contains(second))
      || (first == 192 && second == 168)
      || (first == 198 && (18...19).contains(second))
      || first >= 224
  }

  private static func isPrivateIPv6(_ host: String) -> Bool {
    let normalized = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
      .lowercased()
    if normalized.hasPrefix("::ffff:") {
      return isPrivateIPv4(String(normalized.dropFirst("::ffff:".count)))
    }
    return normalized == "::"
      || normalized == "::1"
      || normalized.hasPrefix("fc")
      || normalized.hasPrefix("fd")
      || normalized.hasPrefix("fe8")
      || normalized.hasPrefix("fe9")
      || normalized.hasPrefix("fea")
      || normalized.hasPrefix("feb")
  }
}

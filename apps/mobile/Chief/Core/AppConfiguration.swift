import Foundation

struct AppConfiguration: Equatable {
  let relayURL: URL
  let accountURL: URL
  let demoMode: Bool

  var authenticationAPIURL: URL { accountURL.appending(path: "api/auth") }
  var authenticationCallbackURL: URL { URL(string: "chief-mobile://auth")! }

  static func chiefCloud(environment: ProcessInfo = .processInfo) -> AppConfiguration {
    let values = environment.environment
    let demo = values["CHIEF_DEMO_MODE"] == "1" || environment.arguments.contains("--demo")
    return AppConfiguration(
      relayURL: URL(
        string: values["CHIEF_RELAY_URL"]
          ?? "https://chief-relay.danielsims-browser-ui.workers.dev"
      )!,
      accountURL: URL(string: values["CHIEF_ACCOUNT_URL"] ?? "https://heychief.sh")!,
      demoMode: demo
    )
  }

  static func current(
    environment: ProcessInfo = .processInfo,
    relayDirectory: RelayDirectoryStore = RelayDirectoryStore()
  ) -> AppConfiguration {
    let values = environment.environment
    let cloud = chiefCloud(environment: environment)
    if values["CHIEF_RELAY_URL"] == nil, let stored = relayDirectory.activeConnection() {
      return AppConfiguration(
        relayURL: stored.relayURL,
        accountURL: stored.accountURL,
        demoMode: cloud.demoMode
      )
    }
    return cloud
  }
}

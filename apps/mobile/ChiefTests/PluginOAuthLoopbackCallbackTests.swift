import Darwin
import Foundation
import Testing

@testable import Chief

struct PluginOAuthLoopbackCallbackTests {
  @Test func loopbackServerWaitsForSafariRequestBytes() async throws {
    let (redirect, server) = try makeServer()
    try await server.start()
    defer { server.stop() }

    let responseTask = Task.detached { try sendDelayedOAuthRequest(to: redirect) }
    let callback = try await server.waitForCallback()
    let response = try await responseTask.value

    #expect(callback.query?.contains("code=notion-code") == true)
    #expect(response.contains("200 OK"))
  }

  @Test func acceptsProviderNormalizedPathOnTheRegisteredLoopbackOrigin() throws {
    let redirect = try #require(URL(string: "http://127.0.0.1:49321/callback"))

    let callback = PluginOAuthLoopbackCallback.url(
      requestLine: "GET /oauth/callback/?code=notion-code&state=expected HTTP/1.1",
      redirectURI: redirect
    )

    #expect(callback?.query?.contains("code=notion-code") == true)
  }

  @Test func ignoresNonOAuthRequestsOnTheLoopbackListener() throws {
    let redirect = try #require(URL(string: "http://127.0.0.1:49321/callback"))

    let callback = PluginOAuthLoopbackCallback.url(
      requestLine: "GET /favicon.ico HTTP/1.1",
      redirectURI: redirect
    )

    #expect(callback == nil)
  }

  @Test func rejectsCallbackFromAnotherLoopbackOrigin() throws {
    let redirect = try #require(URL(string: "http://127.0.0.1:49321/callback"))

    let callback = PluginOAuthLoopbackCallback.url(
      requestLine: "GET http://127.0.0.1:49322/callback?code=stolen HTTP/1.1",
      redirectURI: redirect
    )

    #expect(callback == nil)
  }

  private func makeServer() throws -> (URL, LoopbackOAuthCallbackServer) {
    for _ in 0..<32 {
      let port = Int.random(in: 49_152...65_535)
      guard let redirect = URL(string: "http://127.0.0.1:\(port)/callback") else { continue }
      if let server = try? LoopbackOAuthCallbackServer(redirectURI: redirect) {
        return (redirect, server)
      }
    }
    throw MobilePluginRuntimeError.unavailable("No loopback test port was available.")
  }

  private func sendDelayedOAuthRequest(to redirect: URL) throws -> String {
    let descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw POSIXError(.ENOTSUP) }
    defer { Darwin.close(descriptor) }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(UInt16(redirect.port ?? 0).bigEndian)
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let connected = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard connected == 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .ECONNREFUSED)
    }

    usleep(200_000)
    let request =
      "GET /callback?code=notion-code&state=expected HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    let sent = request.withCString { pointer in
      Darwin.send(descriptor, pointer, strlen(pointer), 0)
    }
    guard sent == request.utf8.count else { throw POSIXError(.EIO) }

    var buffer = [UInt8](repeating: 0, count: 4_096)
    let count = Darwin.recv(descriptor, &buffer, buffer.count, 0)
    guard count > 0 else { throw POSIXError(.ECONNRESET) }
    return String(bytes: buffer.prefix(Int(count)), encoding: .utf8) ?? ""
  }
}

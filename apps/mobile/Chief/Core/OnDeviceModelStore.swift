import Foundation
import Observation

/// An on-device inference model that can be downloaded to the iPhone.
struct DeviceModel: Identifiable, Equatable, Sendable {
  let id: String
  let displayName: String
  let fileName: String
  let remoteURL: URL
  let bytes: Int64
  let summary: String

  var sizeLabel: String {
    ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
  }
}

/// Downloads supported on-device models into Application Support so they
/// survive relaunch. The catalog mirrors the iOS Durable Agent's supported
/// LiteRT Gemma variants. Inference execution itself is not wired into Chief
/// yet; this owns discovery, download, and install state only.
@MainActor
@Observable
final class OnDeviceModelStore {
  static let models: [DeviceModel] = [
    DeviceModel(
      id: "gemma-4-e2b",
      displayName: "Gemma 4 E2B",
      fileName: "gemma-4-E2B-it.litertlm",
      remoteURL: URL(
        string:
          "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm?download=true"
      )!,
      bytes: 2_588_147_712,
      summary: "Fast · fits 8GB devices"
    ),
    DeviceModel(
      id: "gemma-4-e4b",
      displayName: "Gemma 4 E4B",
      fileName: "gemma-4-E4B-it.litertlm",
      remoteURL: URL(
        string:
          "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm?download=true"
      )!,
      bytes: 3_659_530_240,
      summary: "Smarter · needs 12GB+ RAM"
    ),
  ]

  private(set) var downloading: Set<String> = []
  private(set) var activeModelID: String?

  var models: [DeviceModel] { Self.models }

  private let fileManager: FileManager
  private let session: URLSession
  private let modelsDirectory: URL

  init(
    fileManager: FileManager = .default,
    session: URLSession = .shared,
    modelsDirectory: URL? = nil
  ) {
    self.fileManager = fileManager
    self.session = session
    self.modelsDirectory =
      modelsDirectory ?? Self.modelsDirectory(for: fileManager)
  }

  static func modelsDirectory(for fileManager: FileManager = .default) -> URL {
    let base =
      fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Chief", isDirectory: true)
    return base.appendingPathComponent("models", isDirectory: true)
  }

  func fileURL(for model: DeviceModel) -> URL {
    modelsDirectory.appendingPathComponent(model.fileName)
  }

  func isDownloaded(_ id: String) -> Bool {
    guard let model = Self.models.first(where: { $0.id == id }) else {
      return false
    }
    return fileManager.fileExists(atPath: fileURL(for: model).path)
  }

  func isDownloading(_ id: String) -> Bool {
    downloading.contains(id)
  }

  func download(_ model: DeviceModel) async {
    guard !isDownloaded(model.id), !isDownloading(model.id) else {
      if isDownloaded(model.id) { activeModelID = model.id }
      return
    }
    downloading.insert(model.id)
    defer { downloading.remove(model.id) }
    do {
      let (temporary, response) = try await session.download(from: model.remoteURL)
      guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
      try? fileManager.createDirectory(
        at: modelsDirectory,
        withIntermediateDirectories: true
      )
      let destination = fileURL(for: model)
      if fileManager.fileExists(atPath: destination.path) {
        try? fileManager.removeItem(at: destination)
      }
      try fileManager.moveItem(at: temporary, to: destination)
      activeModelID = model.id
      print("[Chief] downloaded model \(model.id)")
    } catch {
      print("[Chief] model download \(model.id) failed: \(error)")
    }
  }
}

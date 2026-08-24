#!/usr/bin/env swift

import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

enum ChiefCodexQRCodeError: Error, CustomStringConvertible {
  case invalidArguments
  case invalidConnection
  case renderFailed

  var description: String {
    switch self {
    case .invalidArguments:
      "usage: chief-codex-bridge-qr.swift <wss-endpoint> <model> <output.png>"
    case .invalidConnection:
      "the endpoint, model, or capability token is invalid"
    case .renderFailed:
      "the QR code could not be rendered"
    }
  }
}

func run() throws {
  guard CommandLine.arguments.count == 4 else {
    throw ChiefCodexQRCodeError.invalidArguments
  }
  let endpoint = CommandLine.arguments[1]
  let model = CommandLine.arguments[2]
  let outputURL = URL(fileURLWithPath: CommandLine.arguments[3])
  let token = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
    .trimmingCharacters(in: .whitespacesAndNewlines)

  guard URL(string: endpoint)?.scheme?.lowercased() == "wss",
    !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
    token.range(of: #"^[0-9a-fA-F]{64}$"#, options: .regularExpression) != nil
  else { throw ChiefCodexQRCodeError.invalidConnection }

  var components = URLComponents()
  components.scheme = "chief-mobile"
  components.host = "connect-codex"
  components.queryItems = [
    URLQueryItem(name: "endpoint", value: endpoint),
    URLQueryItem(name: "token", value: token),
    URLQueryItem(name: "model", value: model),
  ]
  guard let connectionURL = components.url else {
    throw ChiefCodexQRCodeError.invalidConnection
  }

  let filter = CIFilter.qrCodeGenerator()
  filter.message = Data(connectionURL.absoluteString.utf8)
  filter.correctionLevel = "M"
  guard let image = filter.outputImage?.transformed(
    by: CGAffineTransform(scaleX: 12, y: 12)
  ) else { throw ChiefCodexQRCodeError.renderFailed }

  let extent = image.extent.insetBy(dx: -48, dy: -48)
  let composed = image.composited(over: CIImage(color: .white).cropped(to: extent))
  let context = CIContext(options: [.useSoftwareRenderer: false])
  guard let cgImage = context.createCGImage(composed, from: extent) else {
    throw ChiefCodexQRCodeError.renderFailed
  }
  let bitmap = NSBitmapImageRep(cgImage: cgImage)
  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    throw ChiefCodexQRCodeError.renderFailed
  }
  try png.write(to: outputURL, options: .atomic)
}

do {
  try run()
} catch {
  FileHandle.standardError.write(Data("chief-codex-bridge-qr: \(error)\n".utf8))
  exit(1)
}

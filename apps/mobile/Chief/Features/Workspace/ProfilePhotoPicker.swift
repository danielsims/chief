import PhotosUI
import SwiftUI
import ImageIO
import UniformTypeIdentifiers

struct ProfilePhotoPicker: View {
  let imageURL: URL?
  let onChange: (Data?) async throws -> Void
  @State private var selection: PhotosPickerItem?
  @State private var saving = false
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 16) {
        UserAvatar(user: ChiefUser(id: "preview", name: "", imageURL: imageURL), size: 56)
        PhotosPicker(selection: $selection, matching: .images) {
          Text(saving ? "Saving photo…" : "Choose photo")
        }
        .disabled(saving)
      }
      if imageURL != nil {
        Button("Remove photo", role: .destructive) { Task { await save(nil) } }.disabled(saving)
      }
      if let error { Text(error).font(.footnote).foregroundStyle(.red) }
    }
    .padding(.vertical, 6)
    .onChange(of: selection) { _, item in
      guard let item else { return }
      Task {
        saving = true
        error = nil
        do {
          guard let data = try await item.loadTransferable(type: Data.self),
            let jpeg = Self.thumbnail(data) else { throw RelayError.unavailable }
          try await onChange(jpeg)
        } catch { self.error = "Couldn’t save the photo. Try again." }
        saving = false
        selection = nil
      }
    }
  }

  private func save(_ data: Data?) async {
    saving = true
    error = nil
    do { try await onChange(data) }
    catch { self.error = "Couldn’t save the photo. Try again." }
    saving = false
  }

  private static func thumbnail(_ data: Data) -> Data? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 512,
      ] as CFDictionary) else { return nil }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return output as Data
  }
}

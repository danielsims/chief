import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ProfilePhotoPicker: View {
  let imageURL: URL?
  var name: String = ""
  var size: CGFloat = 64
  let onChange: (Data?) async throws -> Void
  @State private var showActions = false
  @State private var showPhotos = false
  @State private var selection: PhotosPickerItem?
  @State private var saving = false
  @State private var error: String?

  var body: some View {
    Button {
      showActions = true
    } label: {
      UserAvatar(user: ChiefUser(id: "preview", name: name, imageURL: imageURL), size: size)
        .overlay(alignment: .bottomTrailing) {
          Image(systemName: "pencil")
            .font(.system(size: 10, weight: .semibold))
            .frame(width: 22, height: 22)
            .background(ChiefTheme.elevated, in: Circle())
            .overlay { Circle().stroke(ChiefTheme.background, lineWidth: 2) }
        }
        .overlay { if saving { ProgressView().tint(.white) } }
    }
    .buttonStyle(.plain)
    .disabled(saving)
    .accessibilityLabel("Edit photo")
    .confirmationDialog("Photo", isPresented: $showActions, titleVisibility: .hidden) {
      Button("Choose photo") { showPhotos = true }
      if imageURL != nil {
        Button("Remove photo", role: .destructive) { Task { await save(nil) } }
      }
      Button("Cancel", role: .cancel) {}
    }
    .photosPicker(isPresented: $showPhotos, selection: $selection, matching: .images)
    .alert(
      "Couldn’t save photo",
      isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })
    ) {
      Button("OK", role: .cancel) { error = nil }
    } message: {
      Text("Please try again.")
    }
    .onChange(of: selection) { _, item in
      guard let item else { return }
      Task {
        saving = true
        error = nil
        do {
          guard let data = try await item.loadTransferable(type: Data.self),
            let jpeg = Self.thumbnail(data)
          else { throw RelayError.unavailable }
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
    do { try await onChange(data) } catch { self.error = "Couldn’t save the photo. Try again." }
    saving = false
  }

  private static func thumbnail(_ data: Data) -> Data? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: 512,
        ] as CFDictionary)
    else { return nil }
    let output = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(
        output, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return output as Data
  }
}

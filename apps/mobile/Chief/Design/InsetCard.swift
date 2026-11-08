import SwiftUI

/// A soft band holding a white card, as desktop draws automation steps and
/// runs (`inset-card.ts`): a quiet header line in the band, the thing itself
/// in the card.
struct InsetBand<Header: View, Content: View>: View {
  @ViewBuilder let header: Header
  @ViewBuilder let content: Content

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) { header }
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.secondary)
        .lineLimit(1)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
      content
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChiefTheme.background, in: InsetShape.card)
        .overlay { InsetShape.card.strokeBorder(ChiefTheme.accent.opacity(0.08)) }
        .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
    }
    .padding(4)
    // Mixed rather than translucent, so nothing behind shows through.
    .background(ChiefTheme.background.mix(with: ChiefTheme.accent, by: 0.04), in: InsetShape.band)
    .overlay { InsetShape.band.strokeBorder(ChiefTheme.accent.opacity(0.07)) }
  }
}

enum InsetShape {
  static let band = RoundedRectangle(cornerRadius: 16, style: .continuous)
  static let card = RoundedRectangle(cornerRadius: 12, style: .continuous)
}

# Vendored codecs

Built into the relay by `build.rs`, so chief-machine stays one static binary
with no system libraries. Trimmed to what Linux on x86_64, aarch64 and armv7
needs; nothing here is modified.

| Library | Version                                                       | Source                                                                                                  | SHA-256 of the download                                            | Licence                           |
| ------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| x264    | stable `b35605ace3ddf7c1a5d67a2eb553f034aef41d55` (build 165) | https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264.tar.bz2 | `6eeb82934e69fd51e043bd8c5b0d152839638d1ce7aa4eea65a3fedcf83ff224` | GPL-2.0-or-later (`x264/COPYING`) |
| Opus    | 1.5.2                                                         | https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz                                              | `65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1` | BSD-3-Clause (`opus/COPYING`)     |

Kept from x264: `common/` and `encoder/` (C, headers, x86 NASM and ARM
assembly) without the PowerPC, MIPS, LoongArch, OpenCL and Windows thread
files, plus `x264.h` and `COPYING`. `build.rs` writes the `config.h` and
`x264_config.h` that x264's `configure` would.

Kept from Opus: `include/`, `src/`, `celt/`, `silk/` and `silk/float/`
without SIMD, fixed-point, demo and test files, plus the `*_sources.mk`
lists `build.rs` reads.

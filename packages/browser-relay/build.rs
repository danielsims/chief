//! Builds the vendored x264 and Opus (see vendor/README.md) into the relay, so
//! the binary needs no codec libraries on the machine. Linux only: other
//! targets build an empty crate.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=vendor");
    println!("cargo:rerun-if-changed=src/x264_shim.c");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
        return;
    }
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    opus(&out);
    x264(&out);
}

/// The source lists Opus's own build reads, for a float build without SIMD.
fn opus(out: &Path) {
    let root = Path::new("vendor/opus");
    let lists = ["celt_sources.mk", "silk_sources.mk", "opus_sources.mk"]
        .map(|name| fs::read_to_string(root.join(name)).expect("opus source list"))
        .join("\n");
    let mut build = cc::Build::new();
    for variable in ["CELT_SOURCES", "SILK_SOURCES", "SILK_SOURCES_FLOAT", "OPUS_SOURCES", "OPUS_SOURCES_FLOAT"] {
        for file in make_list(&lists, variable) {
            build.file(root.join(file));
        }
    }
    build
        .include(root.join("include"))
        .include(root.join("celt"))
        .include(root.join("silk"))
        .include(root.join("silk/float"))
        .include(root.join("src"))
        .define("OPUS_BUILD", None)
        .define("VAR_ARRAYS", None)
        .define("HAVE_LRINT", None)
        .define("HAVE_LRINTF", None)
        .define("ENABLE_HARDENING", None)
        .flag_if_supported("-fvisibility=hidden")
        .warnings(false)
        .opt_level(2)
        .out_dir(out.join("opus"))
        .compile("opus");
}

/// The files a Makefile variable lists, across `\` continuations.
fn make_list(text: &str, variable: &str) -> Vec<String> {
    let start = text
        .find(&format!("{variable} = "))
        .unwrap_or_else(|| panic!("{variable} in opus source lists"));
    let mut files = Vec::new();
    for line in text[start + variable.len() + 3..].lines() {
        let line = line.trim();
        files.extend(line.trim_end_matches('\\').split_whitespace().map(String::from));
        if !line.ends_with('\\') {
            break;
        }
    }
    files
}

#[derive(Clone, Copy, PartialEq)]
enum Arch {
    X86_64,
    Aarch64,
    Armv7,
}

/// What x264's configure would write for this target.
fn x264_config(arch: Arch) -> String {
    let mut lines = vec![
        "#define HAVE_MALLOC_H 1",
        "#define SYS_LINUX 1",
        "#define HAVE_POSIXTHREAD 1",
        "#define HAVE_THREAD 1",
        "#define HAVE_LOG2F 1",
        "#define HAVE_STRTOK_R 1",
        "#define HAVE_CLOCK_GETTIME 1",
        "#define HAVE_GETAUXVAL 1",
        "#define HAVE_SYSCONF 1",
        "#define HAVE_MMAP 1",
        "#define HAVE_VECTOREXT 1",
        "#define fseek fseeko",
        "#define ftell ftello",
        "#define HAVE_BITDEPTH8 1",
        "#define HAVE_BITDEPTH10 0",
        "#define CHROMA_FORMAT CHROMA_420",
        "#define HAVE_GPL 1",
        "#define HAVE_INTERLACED 1",
    ];
    let off = [
        "ALTIVEC", "ALTIVEC_H", "BEOSTHREAD", "WIN32THREAD", "SWSCALE", "LAVF", "FFMS", "GPAC", "AVS",
        "CPU_COUNT", "OPENCL", "LSMASH", "AS_FUNC", "INTEL_DISPATCHER", "MSA", "LSX", "WINRT", "VSX",
        "ELF_AUX_INFO", "SYNC_FETCH_AND_ADD",
    ];
    let (on, arch_off): (&[&str], &[&str]) = match arch {
        Arch::X86_64 => (
            &["#define HAVE_MMX 1", "#define HAVE_X86_INLINE_ASM 1", "#define ARCH_X86_64 1", "#define STACK_ALIGNMENT 64", "#define HAVE_THP 1"],
            &["ARMV6", "ARMV6T2", "NEON", "AARCH64", "ARM_INLINE_ASM", "DOTPROD", "I8MM", "SVE", "SVE2",
              "AS_ARCHEXT_DOTPROD_DIRECTIVE", "AS_ARCHEXT_I8MM_DIRECTIVE", "AS_ARCHEXT_SVE_DIRECTIVE", "AS_ARCHEXT_SVE2_DIRECTIVE"],
        ),
        // NEON is the aarch64 baseline; DOTPROD, I8MM, SVE and SVE2 code is
        // only run on CPUs that report them.
        Arch::Aarch64 => (
            &["#define HAVE_AARCH64 1", "#define HAVE_NEON 1", "#define AS_ARCH_LEVEL armv8.6-a+crc",
              "#define HAVE_AS_ARCHEXT_DOTPROD_DIRECTIVE 1", "#define HAVE_DOTPROD 1",
              "#define HAVE_AS_ARCHEXT_I8MM_DIRECTIVE 1", "#define HAVE_I8MM 1",
              "#define HAVE_AS_ARCHEXT_SVE_DIRECTIVE 1", "#define HAVE_SVE 1",
              "#define HAVE_AS_ARCHEXT_SVE2_DIRECTIVE 1", "#define HAVE_SVE2 1",
              "#define ARCH_AARCH64 1", "#define STACK_ALIGNMENT 16"],
            &["MMX", "ARMV6", "ARMV6T2", "THP", "X86_INLINE_ASM", "ARM_INLINE_ASM"],
        ),
        Arch::Armv7 => (
            &["#define HAVE_ARM_INLINE_ASM 1", "#define HAVE_ARMV6 1", "#define HAVE_ARMV6T2 1", "#define HAVE_NEON 1",
              "#define ARCH_ARM 1", "#define STACK_ALIGNMENT 4"],
            &["MMX", "AARCH64", "THP", "X86_INLINE_ASM", "DOTPROD", "I8MM", "SVE", "SVE2",
              "AS_ARCHEXT_DOTPROD_DIRECTIVE", "AS_ARCHEXT_I8MM_DIRECTIVE", "AS_ARCHEXT_SVE_DIRECTIVE", "AS_ARCHEXT_SVE2_DIRECTIVE"],
        ),
    };
    lines.extend_from_slice(on);
    let mut text = lines.join("\n");
    for name in off.iter().chain(arch_off) {
        text.push_str(&format!("\n#define HAVE_{name} 0"));
    }
    text + "\n"
}

fn x264(out: &Path) {
    let root = PathBuf::from("vendor/x264");
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "x86_64" => Arch::X86_64,
        "aarch64" => Arch::Aarch64,
        "arm" => Arch::Armv7,
        other => panic!("browser-relay has no x264 build for {other}"),
    };
    let generated = out.join("x264-config");
    fs::create_dir_all(&generated).unwrap();
    fs::write(generated.join("config.h"), x264_config(arch)).unwrap();
    fs::write(
        generated.join("x264_config.h"),
        "#define X264_GPL 1\n#define X264_INTERLACED 1\n#define X264_BIT_DEPTH 8\n\
         #define X264_CHROMA_FORMAT X264_CSP_I420\n#define X264_VERSION \"\"\n#define X264_POINTVER \"0.165.x\"\n",
    )
    .unwrap();

    let common = |build: &mut cc::Build| {
        build
            .include(&generated)
            .include(&root)
            .define("_GNU_SOURCE", None)
            .define("PIC", None)
            .flag("-std=gnu99")
            .flag_if_supported("-ffast-math")
            .flag_if_supported("-fomit-frame-pointer")
            .flag_if_supported("-fno-tree-vectorize")
            .flag_if_supported("-fvisibility=hidden")
            .pic(true)
            .warnings(false)
            .opt_level(3);
        if arch == Arch::Armv7 {
            build.flag("-mfpu=neon").flag("-march=armv7-a");
        }
    };

    // Files built once, and files built per bit depth (8 only), as x264's Makefile.
    let once = ["common/osdep.c", "common/base.c", "common/cpu.c", "common/tables.c", "encoder/api.c"];
    let mut per_depth: Vec<&str> = vec![
        "common/mc.c", "common/predict.c", "common/pixel.c", "common/macroblock.c", "common/frame.c",
        "common/dct.c", "common/cabac.c", "common/common.c", "common/rectangle.c", "common/set.c",
        "common/quant.c", "common/deblock.c", "common/vlc.c", "common/mvpred.c", "common/bitstream.c",
        "encoder/analyse.c", "encoder/me.c", "encoder/ratecontrol.c", "encoder/set.c", "encoder/macroblock.c",
        "encoder/cabac.c", "encoder/cavlc.c", "encoder/encoder.c", "encoder/lookahead.c", "common/threadpool.c",
    ];
    let (asm_once, asm_per_depth): (Vec<&str>, Vec<&str>) = match arch {
        Arch::X86_64 => {
            per_depth.extend(["common/x86/mc-c.c", "common/x86/predict-c.c"]);
            (
                vec!["common/x86/cpu-a.asm"],
                vec![
                    "common/x86/dct-64.asm", "common/x86/trellis-64.asm", "common/x86/bitstream-a.asm",
                    "common/x86/const-a.asm", "common/x86/cabac-a.asm", "common/x86/dct-a.asm",
                    "common/x86/deblock-a.asm", "common/x86/mc-a.asm", "common/x86/mc-a2.asm",
                    "common/x86/pixel-a.asm", "common/x86/predict-a.asm", "common/x86/quant-a.asm",
                    "common/x86/sad-a.asm",
                ],
            )
        }
        Arch::Aarch64 => {
            per_depth.extend(["common/aarch64/asm-offsets.c", "common/aarch64/mc-c.c", "common/aarch64/predict-c.c"]);
            (
                vec![],
                vec![
                    "common/aarch64/bitstream-a.S", "common/aarch64/cabac-a.S", "common/aarch64/dct-a.S",
                    "common/aarch64/deblock-a.S", "common/aarch64/mc-a.S", "common/aarch64/pixel-a.S",
                    "common/aarch64/predict-a.S", "common/aarch64/quant-a.S", "common/aarch64/dct-a-sve.S",
                    "common/aarch64/deblock-a-sve.S", "common/aarch64/mc-a-sve.S", "common/aarch64/pixel-a-sve.S",
                    "common/aarch64/dct-a-sve2.S",
                ],
            )
        }
        Arch::Armv7 => {
            per_depth.extend(["common/arm/mc-c.c", "common/arm/predict-c.c"]);
            (
                vec!["common/arm/cpu-a.S"],
                vec![
                    "common/arm/bitstream-a.S", "common/arm/dct-a.S", "common/arm/deblock-a.S", "common/arm/mc-a.S",
                    "common/arm/pixel-a.S", "common/arm/predict-a.S", "common/arm/quant-a.S",
                ],
            )
        }
    };

    let mut build = cc::Build::new();
    common(&mut build);
    for file in once {
        build.file(root.join(file));
    }
    build.file("src/x264_shim.c");
    // Depth-specific sources get their own objects, as with x264's `%-8.o` rule.
    let mut depth = cc::Build::new();
    common(&mut depth);
    depth.define("HIGH_BIT_DEPTH", "0").define("BIT_DEPTH", "8");
    for file in &per_depth {
        depth.file(root.join(file));
    }
    let mut asm_objects = Vec::new();
    match arch {
        Arch::X86_64 => {
            let nasm_out = out.join("x264-nasm");
            fs::create_dir_all(&nasm_out).unwrap();
            for (files, depth8) in [(&asm_once, false), (&asm_per_depth, true)] {
                for file in files.iter() {
                    let object = nasm_out.join(format!("{}{}.o", file.replace('/', "_"), if depth8 { "-8" } else { "" }));
                    let mut nasm = Command::new(env::var("NASM").unwrap_or_else(|_| "nasm".into()));
                    nasm.arg("-I").arg(format!("{}/", generated.display()))
                        .arg("-I").arg(format!("{}/", root.display()))
                        .arg("-I").arg(format!("{}/common/x86/", root.display()))
                        .args(["-DARCH_X86_64=1", "-f", "elf64", "-DSTACK_ALIGNMENT=64", "-DPIC"])
                        .arg("-o").arg(&object)
                        .arg(root.join(file));
                    if depth8 {
                        nasm.args(["-DBIT_DEPTH=8", "-DHIGH_BIT_DEPTH=0", "-Dprivate_prefix=x264_8"]);
                    }
                    let status = nasm.status().expect("nasm, for x264's x86 assembly (apt install nasm / brew install nasm)");
                    assert!(status.success(), "nasm failed on {file}");
                    asm_objects.push(object);
                }
            }
        }
        Arch::Aarch64 | Arch::Armv7 => {
            // Assembled by the C compiler, which runs the preprocessor first.
            for file in &asm_once {
                build.file(root.join(file));
            }
            for file in &asm_per_depth {
                depth.file(root.join(file));
            }
        }
    }
    for object in &asm_objects {
        build.object(object);
    }
    // One archive: the depth-specific objects go in alongside the rest.
    for object in depth.out_dir(out.join("x264-8")).compile_intermediates() {
        build.object(object);
    }
    build.out_dir(out.join("x264")).compile("x264");
}

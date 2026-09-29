fn main() {
    // Written by scripts/package-plugin-runtime.mjs; builds without it pin no runtime.
    let manifest = std::path::Path::new("plugin-runtime-release.json");
    println!("cargo:rerun-if-changed={}", manifest.display());
    std::fs::write(
        std::path::Path::new(&std::env::var("OUT_DIR").unwrap())
            .join("plugin-runtime-release.json"),
        std::fs::read(manifest).unwrap_or_else(|_| b"{}".to_vec()),
    )
    .unwrap();
    println!(
        "cargo:rustc-env=CHIEF_BUILD_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}

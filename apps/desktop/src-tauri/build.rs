fn main() {
    println!(
        "cargo:rustc-env=CHIEF_BUILD_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}

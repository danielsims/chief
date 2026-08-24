// Minimal stubs for v8::WasmModuleCompilation.
//
// rusty_v8's `src/wasm.rs` unconditionally declares the WasmModuleCompilation
// C++ API, but the iOS build compiles V8 with WebAssembly disabled
// (`v8_enable_webassembly=false`), so the C++ ctor/dtor are absent from the
// archive. The POC never touches this API; a call would abort loudly rather
// than silently misbehave.

#include <cstdlib>

namespace v8 {

class WasmModuleCompilation {
 public:
  WasmModuleCompilation();
  ~WasmModuleCompilation();
};

WasmModuleCompilation::WasmModuleCompilation() {
  std::abort();
}

WasmModuleCompilation::~WasmModuleCompilation() {
  std::abort();
}

}  // namespace v8

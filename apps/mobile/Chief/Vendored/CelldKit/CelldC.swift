import Foundation

/// The celld-compatible C FFI surface, imported via the project bridging
/// header (`celld.h`). These constants/functions are declared in `celld.h` and
/// implemented by the vendored `libworker_core.a` static library.
///
/// This enum is intentionally `internal`: the app composes the higher-level
/// `ChiefCellRuntime` rather than touching malloc-owned C strings directly.
enum CelldC {
  @discardableResult
  static func start() -> Bool {
    dw_start() == 0
  }

  static var version: String {
    String(cString: dw_version())
  }

  @discardableResult
  static func setDataDirectory(_ path: String) -> Bool {
    path.withCString { dw_set_data_dir($0) != 0 }
  }

  static func setAICallback(_ callback: dw_ai_callback?) {
    dw_set_ai_callback(callback)
  }

  static func setToolCallback(_ callback: dw_tool_callback?) {
    dw_set_tool_callback(callback)
  }

  static func resetCells() {
    dw_reset_cells()
  }

  @discardableResult
  static func storagePut(scope: String, key: String, json: String) -> Bool {
    scope.withCString { s in
      key.withCString { k in
        json.withCString { v in
          dw_storage_put(s, k, v) != 0
        }
      }
    }
  }

  static func runSQL(scope: String, query: String, bindsJSON: String) -> String? {
    scope.withCString { s in
      query.withCString { q in
        bindsJSON.withCString { b in
          dw_sql_exec(s, q, b)
        }
      }
    }.map { String(freeingUTF8: $0) }
  }

  static func evaluateWorker(
    source: String,
    url: String,
    method: String,
    body: String,
    bindingsJSON: String
  ) -> String? {
    source.withCString { src in
      url.withCString { u in
        method.withCString { m in
          body.withCString { b in
            bindingsJSON.withCString { bj in
              dw_eval_worker(src, u, m, b, bj)
            }
          }
        }
      }
    }.map { String(freeingUTF8: $0) }
  }
}

extension String {
  /// Wraps a malloc-owned C string returned by the FFI. Takes ownership and
  /// frees the buffer via `dw_free`.
  init(freeingUTF8 pointer: UnsafeMutablePointer<CChar>) {
    self.init(cString: pointer)
    dw_free(pointer)
  }
}

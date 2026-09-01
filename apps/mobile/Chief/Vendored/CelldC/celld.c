#include "celld.h"
#include <TargetConditionals.h>
#include <stdlib.h>

// The implementation is linked from worker-core. This translation unit makes
// the stable C contract importable as a Swift Package module.

// The checked-in worker-core archive targets physical iPhones. Keep the rest
// of the app available in Simulator while making the missing cell capability
// explicit to its Swift wrapper instead of failing the entire link step.
#if TARGET_OS_SIMULATOR
int32_t dw_start(void) { return 0; }
const char* dw_version(void) { return "simulator-unavailable"; }
int32_t dw_set_data_dir(const char* dir) { (void)dir; return 0; }
void dw_set_ai_callback(dw_ai_callback cb) { (void)cb; }
void dw_set_tool_callback(dw_tool_callback cb) { (void)cb; }
void dw_reset_cells(void) {}
int32_t dw_storage_put(const char* scope, const char* key, const char* value_json) {
  (void)scope; (void)key; (void)value_json; return 0;
}
int32_t dw_storage_delete(const char* scope, const char* key) {
  (void)scope; (void)key; return 0;
}
char* dw_sql_exec(const char* scope, const char* query, const char* binds_json) {
  (void)scope; (void)query; (void)binds_json; return NULL;
}
char* dw_run_code(const char* scope, const char* code) {
  (void)scope; (void)code; return NULL;
}
char* dw_run_shell(const char* scope, const char* command, const char* cwd) {
  (void)scope; (void)command; (void)cwd; return NULL;
}
char* dw_eval_worker(const char* source, const char* url, const char* method,
                     const char* body, const char* bindings_json) {
  (void)source; (void)url; (void)method; (void)body; (void)bindings_json; return NULL;
}
void dw_free(char* ptr) { free(ptr); }
#endif

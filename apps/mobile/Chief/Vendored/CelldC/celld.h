#ifndef celld_h
#define celld_h

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if __has_feature(nullability)
#pragma clang assume_nonnull begin
#endif

int32_t dw_start(void);
const char* dw_version(void);
int32_t dw_set_data_dir(const char* dir);

typedef const char* _Nullable (*dw_ai_callback)(const char* _Nullable scope,
                                                const char* _Nullable messages_json);
void dw_set_ai_callback(dw_ai_callback _Nullable cb);

typedef const char* _Nullable (*dw_tool_callback)(const char* _Nullable payload);
void dw_set_tool_callback(dw_tool_callback _Nullable cb);

void dw_reset_cells(void);
int32_t dw_storage_put(const char* scope, const char* key,
                       const char* value_json);
int32_t dw_storage_delete(const char* scope, const char* key);
char* _Nullable dw_sql_exec(const char* scope, const char* query, const char* binds_json);
char* _Nullable dw_run_code(const char* scope, const char* code);
char* _Nullable dw_run_shell(const char* scope, const char* command, const char* cwd);
char* _Nullable dw_eval_worker(const char* source, const char* url, const char* method,
                               const char* body, const char* bindings_json);
void dw_free(char* ptr);

#if __has_feature(nullability)
#pragma clang assume_nonnull end
#endif

#ifdef __cplusplus
}
#endif

#endif

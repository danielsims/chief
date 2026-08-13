export interface RuntimeHealthResponse {
  status: 200;
  headers: Record<string, string>;
  body: "chief-runtime-ready";
}

const READY_RESPONSE: RuntimeHealthResponse = {
  status: 200,
  headers: {
    "content-type": "text/plain",
    "cache-control": "no-store",
    "x-chief-runtime": "ready",
    "x-chief-runtime-protocol": "2",
  },
  body: "chief-runtime-ready",
};

/**
 * The supervisor needs a process-liveness signal, not another database query.
 * Reaching this handler proves the runtime owns its port and can service HTTP;
 * database recovery and scheduler readiness happen independently. Keeping that
 * work out of liveness prevents legitimate persistence from triggering a kill.
 */
export function runtimeHealthResponse(): RuntimeHealthResponse {
  return READY_RESPONSE;
}

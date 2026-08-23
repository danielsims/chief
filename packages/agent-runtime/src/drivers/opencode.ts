import { AcpDriver } from "./acp.js";
import { findOpenCode, openCodeConfigContent } from "./opencode-support.js";

export class OpenCodeDriver extends AcpDriver {
  constructor() {
    super({
      name: "opencode",
      command: findOpenCode,
      args: ["acp"],
      configureEnvironment: (options, environment) => {
        environment.OPENCODE_CONFIG_CONTENT = openCodeConfigContent(
          options,
          environment.OPENCODE_CONFIG_CONTENT,
        );
      },
    });
  }
}

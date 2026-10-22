/**
 * Type shims for CopilotKit Runtime v2 subpath exports.
 *
 * The installed package exposes its types through package.json "exports" with
 * .d.mts files, which the project's classic TypeScript moduleResolution cannot
 * follow. Runtime resolution (webpack/Next) is unaffected; these declarations
 * keep type checking on the small surface this product uses.
 */

declare module '@copilotkit/runtime/v2' {
  export class CopilotRuntime {
    constructor(options: Record<string, unknown>);
  }
  export class InMemoryAgentRunner {
    constructor();
  }
  export function createCopilotRuntimeHandler(options: {
    runtime: CopilotRuntime;
    basePath: string;
    [key: string]: unknown;
  }): (request: Request) => Promise<Response>;
}

declare module '@copilotkit/runtime/langgraph' {
  export class LangGraphHttpAgent {
    constructor(config: {
      url: string;
      headers?: Record<string, string>;
      [key: string]: unknown;
    });
  }
}

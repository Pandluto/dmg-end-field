/** In-memory ToolBridge fixtures used by the pure Agent loop tests. */
import type { RuntimeToolProjection, RuntimeToolSettlement, RuntimeToolUpdateListener, RuntimeToolInvocation, RuntimeToolBridge } from '../tool.ts';

export type FakeToolHandler = (
  input: RuntimeToolInvocation,
  signal: AbortSignal,
  onUpdate: RuntimeToolUpdateListener,
) => Promise<RuntimeToolSettlement>;

export class DeferredToolSettlement {
  readonly promise: Promise<RuntimeToolSettlement>;
  private resolvePromise!: (settlement: RuntimeToolSettlement) => void;
  private rejectPromise!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<RuntimeToolSettlement>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(settlement: RuntimeToolSettlement): void {
    this.resolvePromise(settlement);
  }

  reject(error: unknown): void {
    this.rejectPromise(error);
  }
}

export class FakeToolBridge implements RuntimeToolBridge {
  readonly invocations: RuntimeToolInvocation[] = [];
  readonly projectionRevisions: number[] = [];
  readonly updates: Array<{ readonly toolCallId: string; readonly detail: unknown }> = [];
  private readonly handlers: FakeToolHandler[] = [];

  enqueue(handler: FakeToolHandler): void {
    this.handlers.push(handler);
  }

  enqueueSettlement(settlement: RuntimeToolSettlement): void {
    this.enqueue(async () => settlement);
  }

  enqueueDeferred(): DeferredToolSettlement {
    const deferred = new DeferredToolSettlement();
    this.enqueue(async () => deferred.promise);
    return deferred;
  }

  invoke(
    input: RuntimeToolInvocation,
    signal: AbortSignal,
    onUpdate: RuntimeToolUpdateListener,
  ): Promise<RuntimeToolSettlement> {
    this.invocations.push(input);
    this.projectionRevisions.push(input.projectionRevision);
    const handler = this.handlers.shift();
    if (!handler) return Promise.reject(new Error('FakeToolBridge has no planned invocation'));
    return handler(input, signal, async (update) => {
      this.updates.push({ toolCallId: update.toolCallId, detail: update.detail });
      await onUpdate(update);
    });
  }
}

export function projection(revision: number, ...toolNames: string[]): RuntimeToolProjection {
  return {
    revision,
    tools: toolNames.map((name) => ({
      name,
      description: `${name} fixture`,
      inputSchema: { type: 'object' },
      risk: 'read',
    })),
  };
}

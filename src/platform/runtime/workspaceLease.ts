export type WorkspaceLeaseRole = 'writer' | 'reader';

type WorkspaceLeaseListener = (role: WorkspaceLeaseRole) => void;

const LOCK_NAME = 'dmg-end-field:web-lts-writer';
const CHANNEL_NAME = 'dmg-end-field:web-lts-control';

class WorkspaceLeaseCoordinator {
  private role: WorkspaceLeaseRole = 'reader';
  private releaseCurrentLock: (() => void) | null = null;
  private readonly listeners = new Set<WorkspaceLeaseListener>();
  private channel: BroadcastChannel | null = null;
  private acquireInFlight: Promise<WorkspaceLeaseRole> | null = null;

  async start(): Promise<WorkspaceLeaseRole> {
    if (!this.channel && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.addEventListener('message', this.handleChannelMessage);
    }
    return this.tryAcquire();
  }

  getRole(): WorkspaceLeaseRole {
    return this.role;
  }

  subscribe(listener: WorkspaceLeaseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async requestControl(): Promise<WorkspaceLeaseRole> {
    this.channel?.postMessage({ type: 'release-request', requestedAt: Date.now() });
    const deadline = Date.now() + 4_000;
    do {
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      const role = await this.tryAcquire();
      if (role === 'writer') return role;
    } while (Date.now() < deadline);
    return this.role;
  }

  release(): void {
    this.releaseCurrentLock?.();
    this.releaseCurrentLock = null;
    this.setRole('reader');
  }

  close(): void {
    this.release();
    if (this.channel) {
      this.channel.removeEventListener('message', this.handleChannelMessage);
      this.channel.close();
      this.channel = null;
    }
    this.listeners.clear();
  }

  private readonly handleChannelMessage = (event: MessageEvent) => {
    const message = event.data as { type?: unknown } | null;
    if (message?.type !== 'release-request' || this.role !== 'writer') return;
    window.dispatchEvent(new CustomEvent('dmg-workspace-release-requested'));
  };

  private setRole(role: WorkspaceLeaseRole): WorkspaceLeaseRole {
    if (this.role === role) return role;
    this.role = role;
    for (const listener of this.listeners) listener(role);
    return role;
  }

  private tryAcquire(): Promise<WorkspaceLeaseRole> {
    if (this.role === 'writer') return Promise.resolve('writer');
    if (this.acquireInFlight) return this.acquireInFlight;
    if (!navigator.locks) {
      this.setRole('writer');
      return Promise.resolve('writer');
    }

    this.acquireInFlight = new Promise<WorkspaceLeaseRole>((resolve) => {
      void navigator.locks.request(
        LOCK_NAME,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          this.acquireInFlight = null;
          if (!lock) {
            resolve(this.setRole('reader'));
            return;
          }
          let release!: () => void;
          const held = new Promise<void>((heldResolve) => {
            release = heldResolve;
          });
          this.releaseCurrentLock = release;
          resolve(this.setRole('writer'));
          await held;
        },
      );
    });
    return this.acquireInFlight;
  }
}

export const workspaceLease = new WorkspaceLeaseCoordinator();

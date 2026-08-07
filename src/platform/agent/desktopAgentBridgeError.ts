export class DesktopAgentBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

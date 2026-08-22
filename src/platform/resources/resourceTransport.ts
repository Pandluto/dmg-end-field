import { resolvePublicPath } from '../../utils/assetResolver';

export type OfficialResourceTransport = {
  id: string;
  resolve: (path: string) => string;
  fallbackToBundledOnUnavailable?: boolean;
};

const WEB_RESOURCE_TRANSPORT: Readonly<OfficialResourceTransport> = Object.freeze({
  id: 'web-same-origin',
  resolve: resolvePublicPath,
  fallbackToBundledOnUnavailable: false,
});

let activeResourceTransport: OfficialResourceTransport = WEB_RESOURCE_TRANSPORT;

export function installOfficialResourceTransport(
  transport: OfficialResourceTransport,
): () => void {
  if (!transport || typeof transport.id !== 'string' || !transport.id.trim()) {
    throw new TypeError('Official resource transport requires a non-empty id.');
  }
  if (typeof transport.resolve !== 'function') {
    throw new TypeError('Official resource transport requires a resolve function.');
  }
  const previous = activeResourceTransport;
  const installed = Object.freeze({
    ...transport,
    id: transport.id.trim(),
    fallbackToBundledOnUnavailable: transport.fallbackToBundledOnUnavailable === true,
  });
  activeResourceTransport = installed;
  return () => {
    if (activeResourceTransport === installed) activeResourceTransport = previous;
  };
}

export function resolveOfficialResourcePath(path: string): string {
  return activeResourceTransport.resolve(path);
}

export function shouldFallbackToBundledResources(): boolean {
  return activeResourceTransport.fallbackToBundledOnUnavailable === true;
}

export function getOfficialResourceTransportId(): string {
  return activeResourceTransport.id;
}

export function resetOfficialResourceTransportForTests(): void {
  activeResourceTransport = WEB_RESOURCE_TRANSPORT;
}

import { createLegacyFillBrowserHostGateway, LEGACY_FILL_STORAGE_KEYS } from './browserGateway';

type BrowserGateway = ReturnType<typeof createLegacyFillBrowserHostGateway>;
let gateway: BrowserGateway | null = null;

export async function bootstrapLegacyFillHostGateway(): Promise<BrowserGateway | null> {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  if (gateway) return gateway;
  gateway = createLegacyFillBrowserHostGateway({
    storage: window.localStorage,
    emit(event) {
      window.dispatchEvent(new CustomEvent(event.type, { detail: event.detail }));
    },
  });
  const watchedKeys = new Set(Object.values(LEGACY_FILL_STORAGE_KEYS).flatMap((entry) => [entry.current, entry.library]));
  window.addEventListener('storage', (event) => {
    if (event.key && watchedKeys.has(event.key)) void gateway?.publishSnapshot();
  });
  await gateway.publishSnapshot();
  return gateway;
}

export function getLegacyFillHostGateway(): BrowserGateway {
  if (!gateway) throw new Error('Legacy Fill Host gateway has not been bootstrapped');
  return gateway;
}

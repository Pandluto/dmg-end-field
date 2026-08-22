import { installDesktopHostExtension } from './platform/desktop/desktopHostExtension';

declare global {
  interface Window {
    __DMG_DESKTOP_WEB_HOST__?: boolean;
    __DMG_MOBILE_ENTRY__?: boolean;
  }
}

installDesktopHostExtension();
void import('./main');

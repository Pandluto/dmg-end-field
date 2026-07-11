import { useSyncExternalStore } from 'react';
import {
  getTimelineSessionSnapshot,
  refreshTimelineSessionDocument,
  resetActiveTimelineDocument,
  setActiveTimelineDocument,
  setTimelineSessionCheckoutRef,
  subscribeTimelineSession,
} from './timelineSession';

export function useTimelineSession() {
  const session = useSyncExternalStore(
    subscribeTimelineSession,
    getTimelineSessionSnapshot,
    getTimelineSessionSnapshot,
  );
  return {
    ...session,
    setActiveDocument: setActiveTimelineDocument,
    resetActiveDocument: resetActiveTimelineDocument,
    setCheckoutRef: setTimelineSessionCheckoutRef,
    refreshActiveDocument: refreshTimelineSessionDocument,
  };
}

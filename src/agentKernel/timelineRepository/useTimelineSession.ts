import { useSyncExternalStore } from 'react';
import {
  getTimelineSessionSnapshot,
  refreshTimelineSessionDocument,
  resetActiveTimelineDocument,
  setActiveTimelineDocument,
  setTimelineSessionCheckoutRef,
  setTimelineSessionWorkingPayload,
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
    setWorkingPayload: setTimelineSessionWorkingPayload,
    refreshActiveDocument: refreshTimelineSessionDocument,
  };
}

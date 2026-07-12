import { useSyncExternalStore } from 'react';
import { getSyncStatus, subscribeSyncStatus } from './sync';

export const useSyncStatus = () => useSyncExternalStore(subscribeSyncStatus, getSyncStatus);

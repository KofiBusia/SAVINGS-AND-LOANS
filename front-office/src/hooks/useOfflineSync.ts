import { useState, useEffect, useCallback, useRef } from 'react';
import { openDB, IDBPDatabase } from 'idb';
import type { FieldSyncRecord, SyncResponse } from '../pages/api/fieldSync';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncQueueItem {
  id: string;
  record: FieldSyncRecord;
  addedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: 'queued' | 'syncing' | 'synced' | 'failed';
}

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncProgress: number;
  conflicts: SyncResponse['conflicts'];
  failedItems: SyncQueueItem[];
}

export interface OfflineSyncOptions {
  agentId: string;
  deviceId: string;
  batchSize?: number;
  maxRetries?: number;
  syncIntervalMs?: number;
  autoSync?: boolean;
}

interface SyncDB {
  syncQueue: {
    key: string;
    value: SyncQueueItem;
    indexes: { status: string };
  };
  syncMeta: {
    key: string;
    value: { key: string; value: string | number };
  };
}

// ─── IDB Setup ────────────────────────────────────────────────────────────────

let dbInstance: IDBPDatabase<SyncDB> | null = null;

async function getSyncDb(): Promise<IDBPDatabase<SyncDB>> {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB<SyncDB>('ghana-sl-sync-v1', 1, {
    upgrade(db) {
      const store = db.createObjectStore('syncQueue', { keyPath: 'id' });
      store.createIndex('status', 'status');
      db.createObjectStore('syncMeta', { keyPath: 'key' });
    },
  });
  return dbInstance;
}

async function getLastSyncTimestamp(db: IDBPDatabase<SyncDB>): Promise<string> {
  const meta = await db.get('syncMeta', 'lastSyncTimestamp');
  return (meta?.value as string) ?? new Date(0).toISOString();
}

async function setLastSyncTimestamp(db: IDBPDatabase<SyncDB>, ts: string): Promise<void> {
  await db.put('syncMeta', { key: 'lastSyncTimestamp', value: ts });
}

// ─── Checksum ─────────────────────────────────────────────────────────────────

async function computeChecksum(record: FieldSyncRecord): Promise<string> {
  const payload = JSON.stringify({
    id: record.id,
    entityType: record.entityType,
    entityId: record.entityId,
    payload: record.payload,
    capturedAt: record.capturedAt,
    agentId: record.agentId,
  });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineSync(options: OfflineSyncOptions) {
  const {
    agentId,
    deviceId,
    batchSize = 50,
    maxRetries = 3,
    syncIntervalMs = 30_000,
    autoSync = true,
  } = options;

  const [state, setState] = useState<SyncState>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncAt: null,
    lastSyncError: null,
    syncProgress: 0,
    conflicts: [],
    failedItems: [],
  });

  const syncInProgressRef = useRef(false);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Count pending ──────────────────────────────────────────────────────────

  const refreshPendingCount = useCallback(async () => {
    const db = await getSyncDb();
    const queued = await db.getAllFromIndex('syncQueue', 'status', 'queued');
    const failed = await db.getAllFromIndex('syncQueue', 'status', 'failed');
    setState((s) => ({
      ...s,
      pendingCount: queued.length + failed.filter((i) => i.attempts < maxRetries).length,
    }));
  }, [maxRetries]);

  // ── Enqueue a record ───────────────────────────────────────────────────────

  const enqueue = useCallback(
    async (record: Omit<FieldSyncRecord, 'checksum'>) => {
      const checksum = await computeChecksum(record as FieldSyncRecord);
      const fullRecord: FieldSyncRecord = { ...record, checksum } as FieldSyncRecord;

      const item: SyncQueueItem = {
        id: record.id,
        record: fullRecord,
        addedAt: new Date().toISOString(),
        attempts: 0,
        status: 'queued',
      };

      const db = await getSyncDb();
      await db.put('syncQueue', item);
      await refreshPendingCount();
    },
    [refreshPendingCount]
  );

  // ── Remove a synced item ───────────────────────────────────────────────────

  const dequeue = useCallback(async (id: string) => {
    const db = await getSyncDb();
    await db.delete('syncQueue', id);
  }, []);

  // ── Core sync function ─────────────────────────────────────────────────────

  const sync = useCallback(async (): Promise<void> => {
    if (syncInProgressRef.current) return;
    if (!navigator.onLine) return;

    syncInProgressRef.current = true;
    setState((s) => ({ ...s, isSyncing: true, syncProgress: 0, lastSyncError: null }));

    try {
      const db = await getSyncDb();
      const queued = await db.getAllFromIndex('syncQueue', 'status', 'queued');
      const retryable = (await db.getAllFromIndex('syncQueue', 'status', 'failed')).filter(
        (i) => i.attempts < maxRetries
      );
      const toSync = [...queued, ...retryable].slice(0, batchSize);

      if (toSync.length === 0) {
        setState((s) => ({ ...s, isSyncing: false, syncProgress: 100 }));
        return;
      }

      // Mark as syncing
      for (const item of toSync) {
        await db.put('syncQueue', { ...item, status: 'syncing' });
      }

      const lastSyncTimestamp = await getLastSyncTimestamp(db);

      const response = await fetch('/api/fieldSync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          agentId,
          lastSyncTimestamp,
          records: toSync.map((i) => i.record),
          batchId: crypto.randomUUID(),
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`Sync failed: HTTP ${response.status}`);
      }

      const result: SyncResponse = await response.json();

      // Process results
      const rejectedIds = new Set(result.rejected.map((r) => r.recordId));
      const conflictIds = new Set(result.conflicts.map((c) => c.recordId));

      for (const item of toSync) {
        if (rejectedIds.has(item.id)) {
          await db.put('syncQueue', {
            ...item,
            status: 'failed',
            attempts: item.attempts + 1,
            lastAttemptAt: new Date().toISOString(),
            lastError: result.rejected.find((r) => r.recordId === item.id)?.reason,
          });
        } else if (conflictIds.has(item.id)) {
          // Conflict resolved by server — mark synced
          await db.put('syncQueue', { ...item, status: 'synced' });
        } else {
          await db.put('syncQueue', { ...item, status: 'synced' });
        }
      }

      await setLastSyncTimestamp(db, result.processedAt);

      const failedItems = (await db.getAllFromIndex('syncQueue', 'status', 'failed')).filter(
        (i) => i.attempts >= maxRetries
      );

      setState((s) => ({
        ...s,
        isSyncing: false,
        syncProgress: 100,
        lastSyncAt: result.processedAt,
        conflicts: result.conflicts,
        failedItems,
      }));

      await refreshPendingCount();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown sync error';

      // Requeue items as failed
      const db = await getSyncDb();
      const syncing = await db.getAllFromIndex('syncQueue', 'status', 'syncing');
      for (const item of syncing) {
        await db.put('syncQueue', {
          ...item,
          status: 'failed',
          attempts: item.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: errorMsg,
        });
      }

      setState((s) => ({
        ...s,
        isSyncing: false,
        lastSyncError: errorMsg,
      }));
    } finally {
      syncInProgressRef.current = false;
    }
  }, [agentId, deviceId, batchSize, maxRetries, refreshPendingCount]);

  // ── Conflict resolution ────────────────────────────────────────────────────

  const resolveConflict = useCallback(
    async (recordId: string, resolution: 'server_wins' | 'client_wins') => {
      if (resolution === 'client_wins') {
        const db = await getSyncDb();
        const item = await db.get('syncQueue', recordId);
        if (item) {
          await db.put('syncQueue', { ...item, status: 'queued', attempts: 0 });
          await refreshPendingCount();
        }
      }
      setState((s) => ({
        ...s,
        conflicts: s.conflicts.filter((c) => c.recordId !== recordId),
      }));
    },
    [refreshPendingCount]
  );

  // ── Online/Offline events ──────────────────────────────────────────────────

  useEffect(() => {
    const onOnline = () => {
      setState((s) => ({ ...s, isOnline: true }));
      if (autoSync) void sync();
    };
    const onOffline = () => setState((s) => ({ ...s, isOnline: false }));

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void refreshPendingCount();

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [autoSync, sync, refreshPendingCount]);

  // ── Auto-sync interval ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoSync) return;
    syncIntervalRef.current = setInterval(() => {
      if (navigator.onLine) void sync();
    }, syncIntervalMs);

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [autoSync, sync, syncIntervalMs]);

  // ── Service worker background sync ────────────────────────────────────────

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_COMPLETE') {
        void refreshPendingCount();
        if (event.data.lastSyncAt) {
          setState((s) => ({ ...s, lastSyncAt: event.data.lastSyncAt }));
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [refreshPendingCount]);

  return {
    ...state,
    enqueue,
    dequeue,
    sync,
    resolveConflict,
    refreshPendingCount,
  };
}

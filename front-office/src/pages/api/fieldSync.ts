import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FieldSyncRecord {
  id: string;
  clientVersion: number;
  serverVersion?: number;
  entityType:
    | 'customer'
    | 'loan_application'
    | 'payment'
    | 'kyc_document'
    | 'group'
    | 'collection_visit';
  entityId: string;
  payload: Record<string, unknown>;
  gpsCoordinates?: { lat: number; lng: number; accuracy: number };
  deviceId: string;
  agentId: string;
  capturedAt: string;
  syncedAt?: string;
  conflictResolution?: 'server_wins' | 'client_wins' | 'merge';
  checksum: string;
}

export interface SyncRequest {
  deviceId: string;
  agentId: string;
  lastSyncTimestamp: string;
  records: FieldSyncRecord[];
  batchId: string;
}

export interface SyncConflict {
  recordId: string;
  entityType: string;
  entityId: string;
  clientVersion: number;
  serverVersion: number;
  resolution: 'server_wins' | 'client_wins' | 'merge';
  mergedPayload?: Record<string, unknown>;
}

export interface SyncResponse {
  success: boolean;
  batchId: string;
  processedAt: string;
  accepted: number;
  conflicts: SyncConflict[];
  rejected: Array<{ recordId: string; reason: string }>;
  serverRecords: FieldSyncRecord[];
  nextSyncToken: string;
}

// ─── Validation Schemas ───────────────────────────────────────────────────────

const GpsCoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0),
});

const FieldSyncRecordSchema = z.object({
  id: z.string().uuid(),
  clientVersion: z.number().int().min(1),
  entityType: z.enum([
    'customer',
    'loan_application',
    'payment',
    'kyc_document',
    'group',
    'collection_visit',
  ]),
  entityId: z.string().min(1).max(100),
  payload: z.record(z.unknown()),
  gpsCoordinates: GpsCoordinatesSchema.optional(),
  deviceId: z.string().min(1).max(255),
  agentId: z.string().min(1).max(100),
  capturedAt: z.string().datetime(),
  checksum: z.string().length(64),
});

const SyncRequestSchema = z.object({
  deviceId: z.string().min(1).max(255),
  agentId: z.string().min(1).max(100),
  lastSyncTimestamp: z.string().datetime(),
  records: z.array(FieldSyncRecordSchema).max(500),
  batchId: z.string().uuid(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function verifyChecksum(record: FieldSyncRecord): boolean {
  const payload = JSON.stringify({
    id: record.id,
    entityType: record.entityType,
    entityId: record.entityId,
    payload: record.payload,
    capturedAt: record.capturedAt,
    agentId: record.agentId,
  });
  const computed = crypto.createHash('sha256').update(payload).digest('hex');
  return computed === record.checksum;
}

function resolveConflict(
  clientRecord: FieldSyncRecord,
  serverVersion: number,
  serverPayload: Record<string, unknown>
): SyncConflict {
  // Last-write-wins strategy with field-level merge for non-conflicting fields
  const clientTime = new Date(clientRecord.capturedAt).getTime();
  const serverTime = serverPayload['updatedAt']
    ? new Date(serverPayload['updatedAt'] as string).getTime()
    : 0;

  let resolution: 'server_wins' | 'client_wins' | 'merge' = 'server_wins';
  let mergedPayload: Record<string, unknown> | undefined;

  if (clientTime > serverTime) {
    // Client record is newer — merge non-critical fields, client wins on data
    resolution = 'merge';
    mergedPayload = {
      ...serverPayload,
      ...clientRecord.payload,
      _mergedAt: new Date().toISOString(),
      _serverVersion: serverVersion,
      _clientVersion: clientRecord.clientVersion,
    };
  } else {
    resolution = 'server_wins';
  }

  return {
    recordId: clientRecord.id,
    entityType: clientRecord.entityType,
    entityId: clientRecord.entityId,
    clientVersion: clientRecord.clientVersion,
    serverVersion,
    resolution,
    mergedPayload,
  };
}

// Stub: in production this calls your database layer
async function fetchServerRecord(
  entityType: string,
  entityId: string
): Promise<{ version: number; payload: Record<string, unknown> } | null> {
  // Replace with actual DB call
  void entityType;
  void entityId;
  return null;
}

async function persistRecord(
  record: FieldSyncRecord,
  resolvedPayload?: Record<string, unknown>
): Promise<void> {
  // Replace with actual DB write (PostgreSQL / Firestore / etc.)
  void record;
  void resolvedPayload;
}

async function fetchUpdatedSince(
  agentId: string,
  since: string
): Promise<FieldSyncRecord[]> {
  // Replace with DB query for records updated after `since` for this agent's region
  void agentId;
  void since;
  return [];
}

function generateSyncToken(agentId: string, timestamp: string): string {
  return crypto
    .createHmac('sha256', process.env.SYNC_TOKEN_SECRET || 'dev-secret')
    .update(`${agentId}:${timestamp}`)
    .digest('hex');
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const syncRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(deviceId: string): boolean {
  const now = Date.now();
  const limit = syncRateLimitMap.get(deviceId);

  if (!limit || now > limit.resetAt) {
    syncRateLimitMap.set(deviceId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (limit.count >= 30) return false; // 30 syncs per minute per device

  limit.count++;
  return true;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SyncResponse | { error: string; code: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  // Auth check
  const session = await getServerSession(req, res, {
    secret: process.env.NEXTAUTH_SECRET,
    providers: [],
  } as Parameters<typeof getServerSession>[2]);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  // Parse & validate
  const parseResult = SyncRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: parseResult.error.message,
      code: 'VALIDATION_ERROR',
    });
  }

  const syncRequest = parseResult.data;

  // Rate limit
  if (!checkRateLimit(syncRequest.deviceId)) {
    return res.status(429).json({ error: 'Too many sync requests', code: 'RATE_LIMITED' });
  }

  const processedAt = new Date().toISOString();
  const conflicts: SyncConflict[] = [];
  const rejected: Array<{ recordId: string; reason: string }> = [];
  let accepted = 0;

  // Ghana GPS bounds check (optional but recommended for field agents)
  const GHANA_BOUNDS = { minLat: 4.5, maxLat: 11.5, minLng: -3.5, maxLng: 1.5 };

  for (const record of syncRequest.records) {
    // 1. Verify checksum integrity
    if (!verifyChecksum(record as FieldSyncRecord)) {
      rejected.push({ recordId: record.id, reason: 'CHECKSUM_MISMATCH' });
      continue;
    }

    // 2. GPS bounds check for field records
    if (record.gpsCoordinates) {
      const { lat, lng } = record.gpsCoordinates;
      if (
        lat < GHANA_BOUNDS.minLat ||
        lat > GHANA_BOUNDS.maxLat ||
        lng < GHANA_BOUNDS.minLng ||
        lng > GHANA_BOUNDS.maxLng
      ) {
        rejected.push({ recordId: record.id, reason: 'GPS_OUT_OF_GHANA_BOUNDS' });
        continue;
      }
    }

    // 3. Check for server-side version conflict
    const serverRecord = await fetchServerRecord(record.entityType, record.entityId);

    if (serverRecord && serverRecord.version >= record.clientVersion) {
      const conflict = resolveConflict(
        record as FieldSyncRecord,
        serverRecord.version,
        serverRecord.payload
      );
      conflicts.push(conflict);

      if (conflict.resolution === 'client_wins' || conflict.resolution === 'merge') {
        await persistRecord(record as FieldSyncRecord, conflict.mergedPayload);
      }
      continue;
    }

    // 4. Persist record
    await persistRecord(record as FieldSyncRecord);
    accepted++;
  }

  // Fetch server-side updates for this agent since last sync
  const serverRecords = await fetchUpdatedSince(
    syncRequest.agentId,
    syncRequest.lastSyncTimestamp
  );

  const nextSyncToken = generateSyncToken(syncRequest.agentId, processedAt);

  return res.status(200).json({
    success: true,
    batchId: syncRequest.batchId,
    processedAt,
    accepted,
    conflicts,
    rejected,
    serverRecords,
    nextSyncToken,
  });
}

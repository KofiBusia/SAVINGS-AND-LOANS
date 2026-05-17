'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  WifiOff,
  Wifi,
  Upload,
  Camera,
  MapPin,
  Loader,
  CheckCircle,
  AlertTriangle,
  Save,
  RefreshCw,
} from 'lucide-react';
import { openDB, DBSchema, IDBPDatabase } from 'idb';

// ─── IDB Schema ───────────────────────────────────────────────────────────────

interface OfflineDB extends DBSchema {
  pendingForms: {
    key: string;
    value: {
      id: string;
      formType: string;
      data: Record<string, unknown>;
      photos: string[]; // base64
      gps?: { lat: number; lng: number; accuracy: number };
      createdAt: string;
      syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
      retryCount: number;
    };
  };
  photoQueue: {
    key: string;
    value: {
      id: string;
      formId: string;
      base64: string;
      filename: string;
      createdAt: string;
      synced: boolean;
    };
  };
}

const DB_NAME = 'ghana-sl-offline-v1';

async function getDb(): Promise<IDBPDatabase<OfflineDB>> {
  return openDB<OfflineDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('pendingForms')) {
        db.createObjectStore('pendingForms', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('photoQueue')) {
        db.createObjectStore('photoQueue', { keyPath: 'id' });
      }
    },
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

const FieldFormSchema = z.object({
  formType: z.enum(['new_customer', 'loan_repayment', 'collection_visit', 'group_meeting']),
  customerName: z.string().min(2, 'Name required'),
  phoneNumber: z
    .string()
    .regex(/^(?:\+233|0)(2[0-9]|5[0-9])\d{7}$/, 'Valid Ghana phone required'),
  ghanaCardNumber: z
    .string()
    .regex(/^GHA-\d{8}-\d$/, 'Format: GHA-XXXXXXXX-X')
    .optional()
    .or(z.literal('')),
  amount: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
  collectAmount: z.number().min(0).optional(),
  visitOutcome: z
    .enum(['paid', 'promise_to_pay', 'not_at_home', 'refused', 'other'])
    .optional(),
  nextVisitDate: z.string().optional(),
});

type FieldFormData = z.infer<typeof FieldFormSchema>;

// ─── GPS Hook ─────────────────────────────────────────────────────────────────

function useGps() {
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const capture = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported');
      return;
    }
    setLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLoading(false);
      },
      (err) => {
        setGpsError(err.message);
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    );
  }, []);

  return { gps, gpsError, loading, capture };
}

// ─── Sync Indicator ───────────────────────────────────────────────────────────

function SyncIndicator({ pendingCount, syncing }: { pendingCount: number; syncing: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
        syncing
          ? 'bg-blue-100 text-blue-700'
          : pendingCount > 0
          ? 'bg-yellow-100 text-yellow-700'
          : 'bg-green-100 text-green-700'
      }`}
      aria-live="polite"
      aria-label={`Sync status: ${syncing ? 'syncing' : pendingCount > 0 ? `${pendingCount} pending` : 'all synced'}`}
    >
      {syncing ? (
        <RefreshCw className="w-3 h-3 animate-spin" />
      ) : pendingCount > 0 ? (
        <AlertTriangle className="w-3 h-3" />
      ) : (
        <CheckCircle className="w-3 h-3" />
      )}
      {syncing ? 'Syncing…' : pendingCount > 0 ? `${pendingCount} pending sync` : 'All synced'}
    </div>
  );
}

// ─── Photo Capture ────────────────────────────────────────────────────────────

function PhotoCapture({
  photos,
  onAdd,
  onRemove,
}: {
  photos: string[];
  onAdd: (base64: string) => void;
  onRemove: (index: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          onAdd(reader.result);
        }
      };
      reader.readAsDataURL(file);
    });
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div>
      <label className="text-xs font-medium text-gray-700 block mb-2">
        Photos / Evidence
      </label>
      <div className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <div key={i} className="relative w-20 h-20 flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`Photo ${i + 1}`}
              className="w-full h-full object-cover rounded-lg border border-gray-200"
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
              aria-label={`Remove photo ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
        {photos.length < 5 && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
            aria-label="Add photo"
          >
            <Camera className="w-5 h-5" />
            <span className="text-xs mt-1">Add</span>
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden="true"
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface FieldOfflineFormProps {
  defaultFormType?: FieldFormData['formType'];
  agentId: string;
  branchCode: string;
  onSuccess?: (recordId: string) => void;
}

export function FieldOfflineForm({
  defaultFormType = 'collection_visit',
  agentId,
  branchCode,
  onSuccess,
}: FieldOfflineFormProps) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { gps, gpsError, loading: gpsLoading, capture: captureGps } = useGps();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<FieldFormData>({
    resolver: zodResolver(FieldFormSchema),
    defaultValues: { formType: defaultFormType },
  });

  const formType = watch('formType');

  // Online/offline detection
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Count pending
  useEffect(() => {
    let cancelled = false;
    getDb().then(async (db) => {
      const all = await db.getAll('pendingForms');
      if (!cancelled) {
        setPendingCount(all.filter((r) => r.syncStatus === 'pending' || r.syncStatus === 'failed').length);
      }
    });
    return () => { cancelled = true; };
  }, [savedLocally]);

  // Auto-sync when online
  useEffect(() => {
    if (!isOnline) return;
    const sync = async () => {
      setSyncing(true);
      try {
        const db = await getDb();
        const pending = await db.getAll('pendingForms');
        const toSync = pending.filter((r) => r.syncStatus === 'pending' || r.syncStatus === 'failed');

        for (const record of toSync) {
          try {
            const res = await fetch('/api/fieldSync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deviceId: `web-${agentId}`,
                agentId,
                lastSyncTimestamp: new Date(0).toISOString(),
                records: [
                  {
                    id: record.id,
                    clientVersion: 1,
                    entityType: 'collection_visit',
                    entityId: record.id,
                    payload: { ...record.data, photos: record.photos },
                    gpsCoordinates: record.gps,
                    deviceId: `web-${agentId}`,
                    agentId,
                    capturedAt: record.createdAt,
                    checksum: await computeChecksum(record),
                  },
                ],
                batchId: crypto.randomUUID(),
              }),
            });
            if (res.ok) {
              await db.put('pendingForms', { ...record, syncStatus: 'synced', retryCount: 0 });
            } else {
              await db.put('pendingForms', {
                ...record,
                syncStatus: 'failed',
                retryCount: record.retryCount + 1,
              });
            }
          } catch {
            await db.put('pendingForms', {
              ...record,
              syncStatus: 'failed',
              retryCount: record.retryCount + 1,
            });
          }
        }
        const updated = await db.getAll('pendingForms');
        setPendingCount(updated.filter((r) => r.syncStatus === 'pending' || r.syncStatus === 'failed').length);
      } finally {
        setSyncing(false);
      }
    };
    void sync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  async function computeChecksum(record: { id: string; data: Record<string, unknown>; createdAt: string }): Promise<string> {
    const payload = JSON.stringify({ id: record.id, data: record.data, createdAt: record.createdAt });
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const onSubmit = async (data: FieldFormData) => {
    setIsSaving(true);
    const recordId = crypto.randomUUID();
    const record = {
      id: recordId,
      formType: data.formType,
      data: { ...data, agentId, branchCode },
      photos,
      gps: gps ?? undefined,
      createdAt: new Date().toISOString(),
      syncStatus: 'pending' as const,
      retryCount: 0,
    };

    const db = await getDb();
    await db.put('pendingForms', record);

    setSavedLocally(true);
    setIsSaving(false);
    reset({ formType: defaultFormType });
    setPhotos([]);

    // Register background sync if available
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      try {
        await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('field-form-sync');
      } catch {
        // Background sync not available, will sync on next online
      }
    }

    onSuccess?.(recordId);

    // Auto-clear success message
    setTimeout(() => setSavedLocally(false), 3000);
  };

  const inputClass = (err?: { message?: string }) =>
    `w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
      err ? 'border-red-400 bg-red-50' : 'border-gray-300'
    }`;

  return (
    <div className="max-w-xl mx-auto p-4">
      {/* Connection Banner */}
      <div
        className={`flex items-center justify-between px-4 py-2 rounded-lg mb-4 text-sm font-medium ${
          isOnline ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          {isOnline ? 'Online — forms will sync automatically' : 'Offline — forms saved locally'}
        </div>
        <SyncIndicator pendingCount={pendingCount} syncing={syncing} />
      </div>

      {savedLocally && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {isOnline ? 'Record saved and synced.' : 'Record saved offline. Will sync when connected.'}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Save className="w-5 h-5 text-blue-600" />
            Field Data Collection
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Agent: {agentId} · Branch: {branchCode}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4" noValidate>
          {/* Form Type */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Form Type *</label>
            <Controller
              name="formType"
              control={control}
              render={({ field }) => (
                <select {...field} className={inputClass()}>
                  <option value="collection_visit">Collection Visit</option>
                  <option value="new_customer">New Customer Registration</option>
                  <option value="loan_repayment">Loan Repayment Recording</option>
                  <option value="group_meeting">Group Meeting Minutes</option>
                </select>
              )}
            />
          </div>

          {/* Customer Name */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Customer Name *</label>
            <input
              {...register('customerName')}
              placeholder="Full name"
              className={inputClass(errors.customerName)}
              autoComplete="name"
            />
            {errors.customerName && <p className="text-xs text-red-600 mt-1">{errors.customerName.message}</p>}
          </div>

          {/* Phone */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Phone Number *</label>
            <input
              {...register('phoneNumber')}
              placeholder="0XX XXX XXXX"
              type="tel"
              className={inputClass(errors.phoneNumber)}
              autoComplete="tel"
            />
            {errors.phoneNumber && <p className="text-xs text-red-600 mt-1">{errors.phoneNumber.message}</p>}
          </div>

          {/* Ghana Card (for new customers) */}
          {formType === 'new_customer' && (
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Ghana Card Number</label>
              <input
                {...register('ghanaCardNumber')}
                placeholder="GHA-XXXXXXXX-X"
                className={inputClass(errors.ghanaCardNumber)}
              />
              {errors.ghanaCardNumber && <p className="text-xs text-red-600 mt-1">{errors.ghanaCardNumber.message}</p>}
            </div>
          )}

          {/* Amount (for repayment) */}
          {(formType === 'loan_repayment' || formType === 'collection_visit') && (
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">
                {formType === 'loan_repayment' ? 'Repayment Amount (GHS)' : 'Collected Amount (GHS)'}
              </label>
              <input
                {...register('collectAmount', { valueAsNumber: true })}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className={inputClass()}
              />
            </div>
          )}

          {/* Visit Outcome */}
          {formType === 'collection_visit' && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Visit Outcome *</label>
                <select {...register('visitOutcome')} className={inputClass()}>
                  <option value="">Select outcome…</option>
                  <option value="paid">Paid</option>
                  <option value="promise_to_pay">Promise to Pay</option>
                  <option value="not_at_home">Not at Home</option>
                  <option value="refused">Refused Payment</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Next Visit Date</label>
                <input
                  {...register('nextVisitDate')}
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  className={inputClass()}
                />
              </div>
            </>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Notes</label>
            <textarea
              {...register('notes')}
              rows={3}
              placeholder="Additional observations…"
              className={inputClass()}
            />
          </div>

          {/* GPS Capture */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-2">GPS Location</label>
            {gps ? (
              <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                <MapPin className="w-4 h-4 flex-shrink-0" />
                <span>
                  {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)} (±{Math.round(gps.accuracy)}m)
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={captureGps}
                disabled={gpsLoading}
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {gpsLoading ? <Loader className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                {gpsLoading ? 'Getting location…' : 'Capture GPS'}
              </button>
            )}
            {gpsError && <p className="text-xs text-red-600 mt-1">{gpsError}</p>}
          </div>

          {/* Photos */}
          <PhotoCapture
            photos={photos}
            onAdd={(b64) => setPhotos((p) => [...p, b64])}
            onRemove={(i) => setPhotos((p) => p.filter((_, idx) => idx !== i))}
          />

          {/* Submit */}
          <button
            type="submit"
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {isSaving ? 'Saving…' : isOnline ? 'Save & Sync' : 'Save Offline'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default FieldOfflineForm;

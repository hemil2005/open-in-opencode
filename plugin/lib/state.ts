import { READ_TIMEOUT_MS, UPDATE_CHECK_TIMEOUT_MS, type Runner } from "./ocshell"
import {
  decodeDoctor,
  decodeSettings,
  decodeTerminals,
  decodeUpdateInfo,
} from "./types"
import type {
  Doctor,
  ErrorSource,
  Result,
  Settings,
  Snapshot,
  SourceError,
  Terminal,
  UpdateInfo,
} from "./types"

/**
 * Snapshot loading and cache shapes.
 *
 * `loadSnapshot` never rejects. A failed source becomes an entry in
 * `snapshot.errors`; the other sources keep their values.
 */

export const SNAPSHOT_SCHEMA = 1
export const UPDATE_SCHEMA = 1
export const UPDATE_TTL_MS = 15 * 60_000

export type CachedSnapshot = {
  schema: number
  savedAt: number
  ocshellPath: string | null
  doctor: Doctor | null
  settings: Settings | null
  terminals: Terminal[]
  update: UpdateInfo | null
  updateCheckedAt: number | null
}

export type CachedUpdate = {
  schema: number
  checkedAt: number
  info: UpdateInfo | null
}

export function emptySnapshot(): Snapshot {
  return {
    ocshellPath: null,
    doctor: null,
    settings: null,
    terminals: [],
    update: null,
    updateCheckedAt: null,
    errors: [],
  }
}

export function emptyCachedSnapshot(): CachedSnapshot {
  return {
    schema: SNAPSHOT_SCHEMA,
    savedAt: 0,
    ocshellPath: null,
    doctor: null,
    settings: null,
    terminals: [],
    update: null,
    updateCheckedAt: null,
  }
}

export function emptyCachedUpdate(): CachedUpdate {
  return {
    schema: UPDATE_SCHEMA,
    checkedAt: 0,
    info: null,
  }
}

export function snapshotToCache(snapshot: Snapshot, savedAt = Date.now()): CachedSnapshot {
  return {
    schema: SNAPSHOT_SCHEMA,
    savedAt,
    ocshellPath: snapshot.ocshellPath,
    doctor: snapshot.doctor,
    settings: snapshot.settings,
    terminals: snapshot.terminals,
    update: snapshot.update,
    updateCheckedAt: snapshot.updateCheckedAt ?? null,
  }
}

export function cachedToSnapshot(cache: CachedSnapshot): Snapshot | null {
  if (cache.schema !== SNAPSHOT_SCHEMA || cache.savedAt <= 0) return null

  return {
    ocshellPath: cache.ocshellPath,
    doctor: cache.doctor,
    settings: cache.settings,
    terminals: cache.terminals,
    update: cache.update,
    updateCheckedAt: cache.updateCheckedAt,
    errors: [],
  }
}

export function updateToCache(info: UpdateInfo, checkedAt = Date.now()): CachedUpdate {
  return { schema: UPDATE_SCHEMA, checkedAt, info }
}

export function cachedUpdateToInfo(cache: CachedUpdate | null): UpdateInfo | null {
  if (!cache || cache.schema !== UPDATE_SCHEMA) return null
  return cache.info
}

export function isUpdateStale(cache: CachedUpdate | null, now = Date.now()): boolean {
  if (!cache || cache.schema !== UPDATE_SCHEMA || !cache.info) return true
  if (!Number.isFinite(cache.checkedAt) || cache.checkedAt <= 0) return true
  return now - cache.checkedAt > UPDATE_TTL_MS
}

export function decodeCachedSnapshot(value: unknown): CachedSnapshot | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>

  if (record.schema !== SNAPSHOT_SCHEMA) return null
  if (typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) return null
  if (record.ocshellPath !== null && typeof record.ocshellPath !== "string") return null

  try {
    const doctor = record.doctor === null ? null : decodeDoctor(record.doctor)
    const settings = record.settings === null ? null : decodeSettings(record.settings)
    const terminals = decodeTerminals(record.terminals)
    const update = record.update === null ? null : decodeUpdateInfo(record.update)
    const updateCheckedAt =
      typeof record.updateCheckedAt === "number" && Number.isFinite(record.updateCheckedAt)
        ? record.updateCheckedAt
        : null

    return {
      schema: SNAPSHOT_SCHEMA,
      savedAt: record.savedAt,
      ocshellPath: record.ocshellPath,
      doctor,
      settings,
      terminals,
      update,
      updateCheckedAt,
    }
  } catch {
    return null
  }
}

export function decodeCachedUpdate(value: unknown): CachedUpdate | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>

  if (record.schema !== UPDATE_SCHEMA) return null
  if (typeof record.checkedAt !== "number" || !Number.isFinite(record.checkedAt)) return null

  try {
    const info = record.info === null ? null : decodeUpdateInfo(record.info)
    return { schema: UPDATE_SCHEMA, checkedAt: record.checkedAt, info }
  } catch {
    return null
  }
}

function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function readResult<T>(
  settled: PromiseSettledResult<Result<T>>,
  source: ErrorSource,
  errors: SourceError[],
): T | null {
  if (settled.status === "rejected") {
    errors.push({
      source,
      kind: "exit",
      message: reasonMessage(settled.reason),
    })
    return null
  }

  if (!settled.value.ok) {
    errors.push({ ...settled.value.error, source })
    return null
  }

  return settled.value.value
}

export type LoadSnapshotOptions = {
  signal?: AbortSignal
  update?: UpdateInfo | null
  updateCheckedAt?: number | null
}

export async function loadSnapshot(
  runner: Runner,
  options: LoadSnapshotOptions = {},
): Promise<Snapshot> {
  const [doctor, settings, terminals] = await Promise.allSettled([
    runner.json(["doctor", "--json"], decodeDoctor, {
      allowNonZero: true,
      timeoutMs: READ_TIMEOUT_MS,
      signal: options.signal,
    }),
    runner.json(["settings", "list", "--json"], decodeSettings, {
      timeoutMs: READ_TIMEOUT_MS,
      signal: options.signal,
    }),
    runner.json(["settings", "terminals", "--json"], decodeTerminals, {
      timeoutMs: READ_TIMEOUT_MS,
      signal: options.signal,
    }),
  ])

  const errors: SourceError[] = []

  return {
    ocshellPath: runner.resolve() ?? null,
    doctor: readResult(doctor, "doctor", errors),
    settings: readResult(settings, "settings", errors),
    terminals: readResult(terminals, "terminals", errors) ?? [],
    update: options.update ?? null,
    updateCheckedAt: options.updateCheckedAt ?? null,
    errors,
  }
}

export async function checkUpdate(
  runner: Runner,
  signal?: AbortSignal,
): Promise<Result<UpdateInfo>> {
  return runner.json(["update", "check", "--json"], decodeUpdateInfo, {
    timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
    signal,
  })
}

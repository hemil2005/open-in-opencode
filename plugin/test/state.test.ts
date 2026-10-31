import { describe, expect, test } from "bun:test"

import type { RunOptions, Runner } from "../lib/ocshell"
import {
  cachedToSnapshot,
  cachedUpdateToInfo,
  checkUpdate,
  decodeCachedSnapshot,
  decodeCachedUpdate,
  emptyCachedSnapshot,
  emptyCachedUpdate,
  isUpdateStale,
  loadSnapshot,
  snapshotToCache,
  updateToCache,
  SNAPSHOT_SCHEMA,
  UPDATE_SCHEMA,
  UPDATE_TTL_MS,
} from "../lib/state"
import type { Result } from "../lib/types"
import { doctor, settings, terminals, update } from "./fixtures"

type Call = { args: string[]; options?: RunOptions }

function fakeRunner(
  responses: Record<string, unknown>,
  calls: Call[] = [],
  throwOn: Set<string> = new Set(),
): Runner {
  return {
    resolve: () => "C:\\Users\\hemil\\AppData\\Local\\Microsoft\\WindowsApps\\ocshell.exe",
    reset: () => {},
    run: async () => ({
      code: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
      truncated: false,
    }),
    json: async <T,>(
      args: string[],
      decode: (value: unknown) => T,
      options?: RunOptions,
    ): Promise<Result<T>> => {
      const key = args.join(" ")
      calls.push({ args, options })

      if (throwOn.has(key)) throw new Error(`unexpected ${key}`)

      const value = responses[key]
      if (value === undefined) {
        return { ok: false, error: { kind: "not-found", message: `no response for ${key}` } }
      }
      if (value instanceof Error) {
        return { ok: false, error: { kind: "exit", message: value.message } }
      }

      try {
        return { ok: true, value: decode(value) }
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: "shape",
            message: error instanceof Error ? error.message : "shape error",
          },
        }
      }
    },
  }
}

describe("loadSnapshot", () => {
  test("loads every source and keeps update data", async () => {
    const runner = fakeRunner({
      "doctor --json": doctor,
      "settings list --json": settings,
      "settings terminals --json": terminals,
    })

    const snapshot = await loadSnapshot(runner, { update, updateCheckedAt: 1234 })

    expect(snapshot.ocshellPath).toContain("ocshell.exe")
    expect(snapshot.doctor).toEqual(doctor)
    expect(snapshot.settings).toEqual(settings)
    expect(snapshot.terminals).toEqual(terminals)
    expect(snapshot.update).toEqual(update)
    expect(snapshot.updateCheckedAt).toBe(1234)
    expect(snapshot.errors).toEqual([])
  })

  test("keeps partial successes when settings fails", async () => {
    const runner = fakeRunner({
      "doctor --json": doctor,
      "settings list --json": new Error("settings could not be read"),
      "settings terminals --json": terminals,
    })

    const snapshot = await loadSnapshot(runner)

    expect(snapshot.doctor).toEqual(doctor)
    expect(snapshot.settings).toBeNull()
    expect(snapshot.terminals).toEqual(terminals)
    expect(snapshot.errors).toEqual([
      {
        source: "settings",
        kind: "exit",
        message: "settings could not be read",
      },
    ])
  })

  test("keeps partial successes when doctor fails", async () => {
    const runner = fakeRunner({
      "doctor --json": new Error("doctor failed"),
      "settings list --json": settings,
      "settings terminals --json": terminals,
    })

    const snapshot = await loadSnapshot(runner)

    expect(snapshot.doctor).toBeNull()
    expect(snapshot.settings).toEqual(settings)
    expect(snapshot.terminals).toEqual(terminals)
    expect(snapshot.errors[0]).toMatchObject({ source: "doctor", kind: "exit" })
  })

  test("converts rejected promises into source errors", async () => {
    const runner = fakeRunner(
      {
        "doctor --json": doctor,
        "settings list --json": settings,
        "settings terminals --json": terminals,
      },
      [],
      new Set(["doctor --json"]),
    )

    const snapshot = await loadSnapshot(runner)

    expect(snapshot.doctor).toBeNull()
    expect(snapshot.settings).toEqual(settings)
    expect(snapshot.errors[0]).toMatchObject({
      source: "doctor",
      kind: "exit",
      message: "unexpected doctor --json",
    })
  })

  test("uses the read timeout and passes the abort signal", async () => {
    const calls: Call[] = []
    const controller = new AbortController()
    const runner = fakeRunner(
      {
        "doctor --json": doctor,
        "settings list --json": settings,
        "settings terminals --json": terminals,
      },
      calls,
    )

    await loadSnapshot(runner, { signal: controller.signal })

    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call.options?.timeoutMs).toBe(15_000)
      expect(call.options?.signal).toBe(controller.signal)
    }
    expect(calls[0]?.options?.allowNonZero).toBe(true)
  })
})

describe("checkUpdate", () => {
  test("uses the 30 second update timeout", async () => {
    const calls: Call[] = []
    const runner = fakeRunner({ "update check --json": update }, calls)
    const controller = new AbortController()

    const result = await checkUpdate(runner, controller.signal)

    expect(result).toEqual({ ok: true, value: update })
    expect(calls[0]?.options?.timeoutMs).toBe(30_000)
    expect(calls[0]?.options?.signal).toBe(controller.signal)
  })

  test("returns a typed update failure", async () => {
    const result = await checkUpdate(
      fakeRunner({ "update check --json": new Error("no update source configured") }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("exit")
      expect(result.error.message).toBe("no update source configured")
    }
  })
})

describe("cache", () => {
  test("does not cache errors or raw output", () => {
    const cache = snapshotToCache(
      {
        ocshellPath: "C:\\ocshell.exe",
        doctor,
        settings,
        terminals,
        update,
        updateCheckedAt: 10,
        errors: [{ kind: "exit", source: "settings", message: "raw failure", stderr: "output" }],
      },
      500,
    )

    expect(cache).toMatchObject({
      schema: SNAPSHOT_SCHEMA,
      savedAt: 500,
      ocshellPath: "C:\\ocshell.exe",
      updateCheckedAt: 10,
    })
    expect(cache).not.toHaveProperty("errors")
  })

  test("round-trips a valid cache and clears errors", () => {
    const snapshot = {
      ocshellPath: "C:\\ocshell.exe",
      doctor,
      settings,
      terminals,
      update,
      updateCheckedAt: 10,
      errors: [],
    }
    const cache = snapshotToCache(snapshot, 500)
    const restored = cachedToSnapshot(cache)

    expect(restored).toEqual({ ...snapshot, errors: [] })
    expect(decodeCachedSnapshot(cache)).toEqual(cache)
  })

  test("rejects old schemas and malformed shapes", () => {
    const cache = snapshotToCache(
      {
        ocshellPath: null,
        doctor,
        settings,
        terminals,
        update: null,
        updateCheckedAt: null,
        errors: [],
      },
      1,
    )

    expect(cachedToSnapshot({ ...cache, schema: 0 })).toBeNull()
    expect(decodeCachedSnapshot({ ...cache, schema: 0 })).toBeNull()
    expect(decodeCachedSnapshot({ ...cache, doctor: { version: 1 } })).toBeNull()
    expect(decodeCachedSnapshot({ ...cache, terminals: "nope" })).toBeNull()
    expect(decodeCachedSnapshot(null)).toBeNull()
  })

  test("tracks update freshness", () => {
    const now = 1_000_000
    const cache = updateToCache(update, now)

    expect(cachedUpdateToInfo(cache)).toEqual(update)
    expect(isUpdateStale(emptyCachedUpdate(), now)).toBe(true)
    expect(isUpdateStale(cache, now + UPDATE_TTL_MS - 1)).toBe(false)
    expect(isUpdateStale(cache, now + UPDATE_TTL_MS + 1)).toBe(true)
    expect(isUpdateStale({ ...cache, schema: UPDATE_SCHEMA - 1 }, now)).toBe(true)
    expect(cachedUpdateToInfo({ ...cache, schema: UPDATE_SCHEMA - 1 })).toBeNull()
  })

  test("rejects malformed update caches", () => {
    const cache = updateToCache(update, 1000)

    expect(decodeCachedUpdate(cache)).toEqual(cache)
    expect(decodeCachedUpdate({ ...cache, schema: 0 })).toBeNull()
    expect(decodeCachedUpdate({ ...cache, info: { current: "1" } })).toBeNull()
    expect(decodeCachedUpdate({ ...cache, checkedAt: "soon" })).toBeNull()
    expect(decodeCachedUpdate(emptyCachedSnapshot())).toBeNull()
  })
})

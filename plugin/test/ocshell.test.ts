import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { win32 } from "node:path"

import {
  createRunner,
  resolveOcshell,
  type ChildProcessLike,
  type Runner,
} from "../lib/ocshell"
import {
  decodeDoctor,
  decodeSettings,
  decodeTerminals,
  decodeUpdateInfo,
  type Doctor,
  type Settings,
  type Terminal,
  type UpdateInfo,
} from "../lib/types"

class FakeStream extends EventEmitter {
  push(chunk: Buffer | string): void {
    this.emit("data", typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
}

class FakeChild extends EventEmitter implements ChildProcessLike {
  readonly stdout = new FakeStream()
  readonly stderr = new FakeStream()
  killed = false

  kill(): boolean {
    this.killed = true
    return true
  }

  close(code: number | null): void {
    this.emit("close", code, null)
  }
}

type Harness = {
  child: FakeChild
  runner: Runner
  spawned: () => number
}

function harness(resolve: () => string | undefined = () => "ocshell.exe"): Harness {
  const child = new FakeChild()
  let count = 0

  const runner = createRunner({
    resolve,
    spawn: () => {
      count += 1
      return child
    },
  })

  return { child, runner, spawned: () => count }
}

const doctor: Doctor = {
  version: "0.7.0.1",
  settingsPath: "C:\\Users\\hemil\\AppData\\Roaming\\OpenInOpenCode\\settings.json",
  settingsLoaded: true,
  settingsWarning: "",
  binaryFound: true,
  binaryPath: "C:\\Users\\hemil\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe",
  binarySource: "npm",
  package: "OpenInOpenCode_0.7.0.1_x64__jqs6rpst54t28",
  certificate: "trusted",
  terminalCount: 8,
  terminal: "wezterm-gui",
}

const settings: Settings = {
  version: 1,
  binaryPath: "",
  updateUri: "",
  continueFromProjectRoot: false,
  logging: false,
  terminal: {
    mode: "auto",
    id: "wezterm-gui",
    customPath: "",
    customArgs: [],
  },
}

const terminals: Terminal[] = [
  {
    id: "wt",
    name: "Windows Terminal",
    path: "C:\\Program Files\\WindowsApps\\wt.exe",
    supported: true,
  },
  {
    id: "git-bash",
    name: "Git Bash",
    path: "C:\\Program Files\\Git\\git-bash.exe",
    supported: false,
  },
]

const update: UpdateInfo = {
  current: "0.7.0.1",
  available: "0.8.0.0",
  updateAvailable: true,
  bundleUri: "https://example.test/OpenInOpenCode.msix",
  installerUri: "https://example.test/OpenInOpenCode.appinstaller",
}

describe("run", () => {
  test("returns stdout, stderr and the exit code", async () => {
    const h = harness()
    const promise = h.runner.run(["version"])

    h.child.stdout.push("0.7.0.1\n")
    h.child.stderr.push("")
    h.child.close(0)

    expect(await promise).toEqual({
      code: 0,
      stdout: "0.7.0.1\n",
      stderr: "",
      timedOut: false,
      aborted: false,
      truncated: false,
    })
    expect(h.spawned()).toBe(1)
  })

  test("reports a non-zero exit without throwing", async () => {
    const h = harness()
    const promise = h.runner.run(["settings", "set", "terminal.mode", "bogus"])

    h.child.stderr.push("terminal.mode must be auto, default or custom\n")
    h.child.close(2)

    expect(await promise).toEqual({
      code: 2,
      stdout: "",
      stderr: "terminal.mode must be auto, default or custom\n",
      timedOut: false,
      aborted: false,
      truncated: false,
    })
  })

  test("times out a hung child and kills it", async () => {
    const h = harness()
    const result = await h.runner.run(["doctor"], { timeoutMs: 10 })

    expect(result.timedOut).toBe(true)
    expect(result.code).toBeNull()
    expect(result.aborted).toBe(false)
    expect(h.child.killed).toBe(true)
  })

  test("aborts a running child", async () => {
    const h = harness()
    const controller = new AbortController()
    const promise = h.runner.run(["doctor"], { signal: controller.signal })

    controller.abort()

    const result = await promise
    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.code).toBeNull()
    expect(h.child.killed).toBe(true)
  })

  test("does not spawn when the signal is already aborted", async () => {
    const h = harness()
    const controller = new AbortController()
    controller.abort()

    const result = await h.runner.run(["version"], { signal: controller.signal })

    expect(result.aborted).toBe(true)
    expect(h.spawned()).toBe(0)
  })

  test("does not spawn when the binary is missing", async () => {
    const h = harness(() => undefined)

    const result = await h.runner.run(["version"])

    expect(result.code).toBeNull()
    expect(result.stderr).toContain("not found")
    expect(h.spawned()).toBe(0)
  })

  test("caps each stream at maxBytes, drains the rest and marks truncation", async () => {
    const h = harness()
    const promise = h.runner.run(["doctor"], { maxBytes: 8 })

    h.child.stdout.push("abcdefghij")
    h.child.stderr.push("0123456789")
    h.child.stdout.push("ignored after the cap")
    h.child.close(0)

    const result = await promise
    expect(result.stdout).toBe("abcdefgh")
    expect(result.stderr).toBe("01234567")
    expect(result.truncated).toBe(true)
  })

  test("decodes UTF-8 split across chunks", async () => {
    const h = harness()
    const promise = h.runner.run(["version"])

    const bytes = Buffer.from("é")
    h.child.stdout.push(bytes.subarray(0, 1))
    h.child.stdout.push(bytes.subarray(1))
    h.child.close(0)

    expect((await promise).stdout).toBe("é")
  })
})

describe("json", () => {
  test("decodes settings", async () => {
    const h = harness()
    const promise = h.runner.json(["settings", "list", "--json"], decodeSettings)

    h.child.stdout.push(JSON.stringify(settings))
    h.child.close(0)

    expect(await promise).toEqual({ ok: true, value: settings })
  })

  test("decodes terminals", async () => {
    const h = harness()
    const promise = h.runner.json(["settings", "terminals", "--json"], decodeTerminals)

    h.child.stdout.push(JSON.stringify(terminals))
    h.child.close(0)

    expect(await promise).toEqual({ ok: true, value: terminals })
  })

  test("decodes update information", async () => {
    const h = harness()
    const promise = h.runner.json(["update", "check", "--json"], decodeUpdateInfo)

    h.child.stdout.push(JSON.stringify(update))
    h.child.close(0)

    expect(await promise).toEqual({ ok: true, value: update })
  })

  test("reports invalid JSON as a parse error", async () => {
    const h = harness()
    const promise = h.runner.json(["settings", "list", "--json"], decodeSettings)

    h.child.stdout.push("not json")
    h.child.close(0)

    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("parse")
      expect(result.error.command).toBe("ocshell.exe settings list --json")
      expect(result.error.stdout).toBe("not json")
      expect(result.error.code).toBe(0)
    }
  })

  test("reports a malformed shape as a shape error", async () => {
    const h = harness()
    const promise = h.runner.json(["settings", "list", "--json"], decodeSettings)

    h.child.stdout.push(JSON.stringify({ version: 1 }))
    h.child.close(0)

    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("shape")
      expect(result.error.message).toContain("settings.terminal")
    }
  })

  test("rejects a non-zero exit unless allowNonZero is set", async () => {
    const h = harness()
    const promise = h.runner.json(["settings", "list", "--json"], decodeSettings)

    h.child.stdout.push(JSON.stringify(settings))
    h.child.stderr.push("settings could not be read\n")
    h.child.close(1)

    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("exit")
      expect(result.error.code).toBe(1)
      expect(result.error.stderr).toContain("could not be read")
    }
  })

  test("accepts JSON on a non-zero exit with allowNonZero", async () => {
    const h = harness()
    const promise = h.runner.json(["doctor", "--json"], decodeDoctor, { allowNonZero: true })

    h.child.stdout.push(JSON.stringify(doctor))
    h.child.close(1)

    expect(await promise).toEqual({ ok: true, value: doctor })
  })

  test("reports a missing binary as not-found without spawning", async () => {
    const h = harness(() => undefined)

    const result = await h.runner.json(["doctor", "--json"], decodeDoctor, { allowNonZero: true })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("not-found")
      expect(result.error.command).toBe("ocshell.exe doctor --json")
    }
    expect(h.spawned()).toBe(0)
  })
})

describe("resolve", () => {
  test("caches the result and re-resolves after reset", () => {
    let value: string | undefined
    let calls = 0

    const runner = createRunner({
      resolve: () => {
        calls += 1
        return value
      },
      spawn: () => new FakeChild(),
    })

    expect(runner.resolve()).toBeUndefined()
    value = "ocshell.exe"
    expect(runner.resolve()).toBeUndefined()
    expect(calls).toBe(1)

    runner.reset()
    expect(runner.resolve()).toBe("ocshell.exe")
    expect(calls).toBe(2)
  })

  test("prefers OCSHELL_PATH, then PATH, then the WindowsApps alias", () => {
    const custom = win32.join("C:\\", "custom", "ocshell.exe")
    const quoted = win32.join("C:\\", "Program Files", "bin", "ocshell.exe")
    const fromPath = win32.join("C:\\", "bin", "ocshell.exe")
    const alias = win32.join(
      "C:\\",
      "Users",
      "me",
      "AppData",
      "Local",
      "Microsoft",
      "WindowsApps",
      "ocshell.exe",
    )

    const found = new Set([custom, quoted, fromPath, alias])
    const exists = (path: string) => found.has(path)

    expect(
      resolveOcshell({
        platform: "win32",
        env: {
          OCSHELL_PATH: custom,
          PATH: `"C:\\Program Files\\bin";C:\\bin`,
          LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        },
        exists,
      }),
    ).toBe(custom)

    expect(
      resolveOcshell({
        platform: "win32",
        env: {
          OCSHELL_PATH: "C:\\missing\\ocshell.exe",
          PATH: `"C:\\Program Files\\bin";C:\\bin`,
          LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        },
        exists,
      }),
    ).toBe(quoted)

    expect(
      resolveOcshell({
        platform: "win32",
        env: {
          PATH: "",
          LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        },
        exists,
      }),
    ).toBe(alias)

    expect(
      resolveOcshell({
        platform: "win32",
        env: { PATH: "" },
        exists: () => false,
      }),
    ).toBeUndefined()

    expect(
      resolveOcshell({
        platform: "linux",
        env: { OCSHELL_PATH: custom },
        exists: () => true,
      }),
    ).toBeUndefined()
  })
})

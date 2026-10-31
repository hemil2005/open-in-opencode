/** @jsxImportSource @opentui/solid */
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js"

import { health, truncateMiddle } from "../lib/format"
import { createRunner, runProcess } from "../lib/ocshell"
import { buildReport, copyText, type CopyResult } from "../lib/report"
import {
  cachedToSnapshot,
  cachedUpdateToInfo,
  checkUpdate,
  decodeCachedSnapshot,
  decodeCachedUpdate,
  emptyCachedSnapshot,
  emptyCachedUpdate,
  emptySnapshot,
  isUpdateStale,
  loadSnapshot,
  snapshotToCache,
  updateToCache,
  type CachedSnapshot,
  type CachedUpdate,
} from "../lib/state"
import type { Snapshot, SourceError, UpdateInfo } from "../lib/types"
import { DiagnosticsDetail } from "./diagnostics"
import {
  addLaunchOption,
  editBinaryPath,
  editCustomArgs,
  editCustomPath,
  editUpdateUri,
  pickTerminal,
  selectTerminalMode,
  toggleSetting,
  type EditorHooks,
} from "./editors"
import { LaunchManager } from "./launch"
import { buildRows, type Row, type RowAction, type RowTone } from "./rows"
import { applyUpdate } from "./updates"

type Context = Plugin.Context

const WRITE_ACTIONS: ReadonlySet<RowAction> = new Set([
  "terminal",
  "binaryPath",
  "continueFromProjectRoot",
  "logging",
  "updateUri",
  "updates",
  "terminalMode",
  "customPath",
  "customArgs",
  "launchOptions",
  "launchAdd",
])

function looksLikePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)
}

export function Dashboard(props: { context: Context; onClose: () => void }) {
  const context = props.context
  const theme = () => context.theme
  const runner = createRunner()

  const [snapshotCache, setSnapshotCache] = context.storage.store<CachedSnapshot>("snapshot", {
    initial: emptyCachedSnapshot(),
  })
  const [updateCache, setUpdateCache] = context.storage.store<CachedUpdate>("update", {
    initial: emptyCachedUpdate(),
  })

  const [snapshot, setSnapshot] = createSignal<Snapshot | null>(null)
  const [selectedId, setSelectedId] = createSignal("terminal")
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [writeError, setWriteError] = createSignal<SourceError | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [refreshing, setRefreshing] = createSignal(false)
  const [applying, setApplying] = createSignal(false)
  const [progress, setProgress] = createSignal<string[]>([])
  const [dialogOpen, setDialogOpen] = createSignal(false)
  const [detailsOpen, setDetailsOpen] = createSignal(false)
  const [launchOpen, setLaunchOpen] = createSignal(false)
  const [width, setWidth] = createSignal(context.renderer.width)
  const [updatedAt, setUpdatedAt] = createSignal<number | null>(null)

  let scroll: ScrollBoxRenderable | undefined
  let controller: AbortController | undefined
  let generation = 0
  let disposed = false

  const currentSnapshot = () => snapshot() ?? emptySnapshot()
  const summary = createMemo(() =>
    health(
      currentSnapshot().doctor,
      currentSnapshot().settings,
      currentSnapshot().terminals,
      currentSnapshot().update,
      currentSnapshot().errors.some((error) => error.source === "update"),
    ),
  )
  const model = createMemo(() => buildRows(currentSnapshot()))
  const rows = () => model().rows
  const selectedRow = () => rows().find((row) => row.id === selectedId()) ?? rows()[0]
  const bannerError = () => writeError() ?? snapshot()?.errors[0] ?? null

  const healthColor = () => {
    if (summary().level === "error") return theme().text.feedback.error.base
    if (summary().level === "warn") return theme().text.feedback.warning.base
    return theme().text.feedback.success.base
  }

  const healthMarker = () => (summary().level === "ok" ? "ok" : summary().level === "warn" ? "!" : "x")

  const headerStatus = () => {
    if (loading() && !snapshot()) return { text: "loading...", color: theme().text.muted }
    if (refreshing()) return { text: "refreshing...", color: theme().text.muted }
    return { text: `${currentSnapshot().doctor?.version ?? "?"}  ${healthMarker()}`, color: healthColor() }
  }

  const updatedLabel = () => {
    const at = updatedAt()
    if (!at) return ""
    return `updated ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  }

  const bannerText = () => {
    const error = bannerError()
    if (!error) return ""
    const source = error.source ?? "ocshell"
    const line = error.message.split(/\r?\n/)[0] ?? ""
    return truncateMiddle(`${source}: ${line}`, Math.max(14, width() - 18))
  }

  const actionLabel = (row: Row | undefined): string => {
    if (!row) return "change"
    if (row.disabled) return "unavailable"
    switch (row.action) {
      case "package":
      case "ocshell":
      case "settings":
        return "copy"
      case "certificate":
      case "diagnostics":
        return "details"
      case "binary":
      case "binaryPath":
      case "updateUri":
      case "customPath":
      case "customArgs":
        return "edit"
      case "terminal":
      case "terminalMode":
        return "choose"
      case "continueFromProjectRoot":
      case "logging":
        return "toggle"
      case "launchOptions":
        return "manage"
      case "launchAdd":
        return "add"
      case "updates":
        return currentSnapshot().update?.updateAvailable ? "install" : "check"
    }
  }

  const footerKeys = () => {
    if (busy()) return "working...  [esc] back"
    const action = actionLabel(selectedRow())
    return width() < 100
      ? `[enter] ${action}  [r] refresh  [c] copy  [esc] back`
      : `[enter] ${action}  [r] refresh  [c] copy report  [d] details  [esc] back`
  }

  function move(delta: number): void {
    const list = rows()
    if (list.length === 0) return
    const index = Math.max(0, list.findIndex((row) => row.id === selectedId()))
    const next = (index + delta + list.length) % list.length
    const target = list[next]
    if (target) setSelectedId(target.id)
  }

  function activateSelected(): void {
    const row = selectedRow()
    if (row) void activate(row)
  }

  async function withDialog<T>(action: () => Promise<T>): Promise<T> {
    if (dialogOpen()) return action()
    setDialogOpen(true)
    try {
      return await action()
    } finally {
      setDialogOpen(false)
    }
  }

  function showDetails(): void {
    setDetailsOpen(true)
    setDialogOpen(true)
  }

  function closeDetails(): void {
    setDetailsOpen(false)
    setDialogOpen(false)
  }

  function showLaunchOptions(): void {
    setLaunchOpen(true)
  }

  function closeLaunchOptions(): void {
    setLaunchOpen(false)
  }

  async function copy(text: string): Promise<CopyResult> {
    return copyText(text, {
      osc52: (value) => context.renderer.copyToClipboardOSC52(value),
      clip: async (value) => {
        const result = await runProcess("clip.exe", [], { input: value, timeoutMs: 10_000 })
        return result.code === 0
      },
      tempFile: async (value) => {
        const path = join(
          tmpdir(),
          `ocshell-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
        )
        await writeFile(path, value, "utf8")
        return path
      },
    })
  }

  async function copyAndReport(text: string): Promise<void> {
    const result = await copy(text)
    if (!result.ok) {
      const error: SourceError = { kind: "exit", source: "write", message: result.message }
      setWriteError(error)
      context.ui.toast.show({ message: result.message, variant: "error", duration: 10_000 })
      return
    }

    const message =
      result.method === "osc52"
        ? "Copied to the terminal clipboard."
        : result.method === "clip"
          ? "Copied with clip.exe."
          : `Clipboard unavailable. Report saved to ${result.path}`

    setMessage(message)
    context.ui.toast.show({
      message,
      variant: result.method === "file" ? "warning" : "success",
      duration: result.method === "file" ? 10_000 : 3000,
    })
  }

  async function copyReport(): Promise<void> {
    if (!loading() && snapshot() && !snapshot()?.ocshellPath) {
      await copyAndReport("ocshell.exe version")
      return
    }
    await copyAndReport(buildReport(currentSnapshot(), new Date()))
  }

  async function runUpdateCheck(current: number, signal: AbortSignal): Promise<void> {
    const result = await checkUpdate(runner, signal)
    if (disposed || current !== generation) return

    if (result.ok) {
      const info = result.value
      const checkedAt = Date.now()
      await setUpdateCache((draft) => {
        Object.assign(draft, updateToCache(info, checkedAt))
      })
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              update: info,
              updateCheckedAt: checkedAt,
              errors: previous.errors.filter((error) => error.source !== "update"),
            }
          : previous,
      )
      return
    }

    const error: SourceError = { ...result.error, source: "update" }
    setSnapshot((previous) =>
      previous
        ? {
            ...previous,
            errors: [
              ...previous.errors.filter((item) => item.source !== "update"),
              error,
            ],
          }
        : previous,
    )
  }

  async function refresh(forceUpdate = false, skipUpdateCheck = false): Promise<void> {
    const current = ++generation
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal

    setRefreshing(true)
    setMessage("")

    if (forceUpdate) {
      void setUpdateCache((draft) => {
        Object.assign(draft, emptyCachedUpdate())
      })
    }

    try {
      const cachedUpdate = forceUpdate ? emptyCachedUpdate() : decodeCachedUpdate(updateCache)
      const update = skipUpdateCheck ? null : cachedUpdateToInfo(cachedUpdate)
      const checkedAt = skipUpdateCheck ? null : cachedUpdate?.checkedAt ?? null

      const next = await loadSnapshot(runner, {
        signal,
        update,
        updateCheckedAt: checkedAt,
      })

      if (disposed || current !== generation) return

      setSnapshot(next)
      setLoading(false)

      const cache = snapshotToCache(next)
      setUpdatedAt(cache.savedAt)
      await setSnapshotCache((draft) => {
        Object.assign(draft, cache)
      })

      if (!skipUpdateCheck && (forceUpdate || isUpdateStale(cachedUpdate))) {
        void runUpdateCheck(current, signal)
      }
    } catch (error) {
      if (!disposed && current === generation) {
        const message = error instanceof Error ? error.message : String(error)
        setSnapshot((previous) => ({
          ...(previous ?? emptySnapshot()),
          errors: [
            ...(previous?.errors ?? []),
            { kind: "exit", message },
          ],
        }))
        setLoading(false)
      }
    } finally {
      if (!disposed && current === generation) setRefreshing(false)
    }
  }

  async function showDetail(row: Row): Promise<void> {
    await withDialog(() =>
      context.ui.dialog.alert({
        title: row.label,
        message: row.detail ?? row.value,
      }),
    )
  }

  function editorHooks(): EditorHooks {
    return {
      context,
      runner,
      snapshot: currentSnapshot(),
      refresh: (forceUpdate?: boolean) => refresh(forceUpdate),
      dialog: withDialog,
      setBusy,
      setError: setWriteError,
    }
  }

  async function handleUpdates(): Promise<void> {
    if (busy() || applying()) return

    const current = currentSnapshot()
    if (!current.ocshellPath) return
    if (!current.doctor?.package.trim()) {
      await withDialog(() =>
        context.ui.dialog.alert({
          title: "Update unavailable",
          message: "Install the MSIX package first.",
        }),
      )
      return
    }

    let info: UpdateInfo | null = current.update

    if (!info || !info.updateAvailable) {
      setBusy(true)
      const result = await checkUpdate(runner)
      setBusy(false)
      if (disposed) return

      if (!result.ok) {
        const error: SourceError = { ...result.error, source: "update" }
        setSnapshot((previous) =>
          previous
            ? {
                ...previous,
                errors: [
                  ...previous.errors.filter((item) => item.source !== "update"),
                  error,
                ],
              }
            : previous,
        )
        context.ui.toast.show({
          message: "Update check failed. Press d for details.",
          variant: "error",
          duration: 5000,
        })
        return
      }

      info = result.value
      const checkedAt = Date.now()
      const nextInfo = info
      await setUpdateCache((draft) => {
        Object.assign(draft, updateToCache(nextInfo, checkedAt))
      })
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              update: nextInfo,
              updateCheckedAt: checkedAt,
              errors: previous.errors.filter((item) => item.source !== "update"),
            }
          : previous,
      )
    }

    if (!info) return

    if (!info.updateAvailable) {
      await withDialog(() =>
        context.ui.dialog.alert({
          title: "Updates",
          message: `Open in OpenCode ${info?.current} is up to date.`,
        }),
      )
      return
    }

    const confirmed = await withDialog(() =>
      context.ui.dialog.confirm({
        title: "Update available",
        message: `Installed ${info?.current}, available ${info?.available}. Install it now?`,
        label: { confirm: "Install", cancel: "Later" },
      }),
    )

    if (!confirmed || disposed) return
    await applyCurrentUpdate(info)
  }

  async function applyCurrentUpdate(info: UpdateInfo): Promise<void> {
    const packageName = currentSnapshot().doctor?.package.trim() ?? ""
    if (!packageName) return

    setApplying(true)
    setProgress([])
    setWriteError(null)

    try {
      const outcome = await applyUpdate({
        runner,
        packageName,
        onProgress: (lines) => setProgress(lines),
      })

      if (disposed) return

      if (outcome.ok) {
        context.ui.toast.show({
          message: "Updated. Restart OpenCode to finish.",
          variant: "success",
          duration: 5000,
        })
        await setUpdateCache((draft) => {
          Object.assign(draft, emptyCachedUpdate())
        })
        setSnapshot((previous) =>
          previous ? { ...previous, update: null, updateCheckedAt: null } : previous,
        )
        await refresh(false, true)
      } else {
        setWriteError(outcome.error)
        context.ui.toast.show({
          message: outcome.needsElevation
            ? "Update needs elevation. Run it in a terminal."
            : "Update failed. Press d for details.",
          variant: "error",
          duration: 10_000,
        })
      }
    } finally {
      if (!disposed) {
        setApplying(false)
        setProgress([])
      }
    }
  }

  async function activate(row: Row): Promise<void> {
    if (busy() || applying()) return

    if (row.disabled) {
      context.ui.toast.show({
        message: row.disabledReason ?? "This row is unavailable.",
        variant: "warning",
      })
      return
    }

    const hooks = editorHooks()

    switch (row.action) {
      case "package":
      case "ocshell":
      case "settings":
        await copyAndReport(row.copy ?? row.value)
        return
      case "certificate":
        await showDetail(row)
        return
      case "binary":
        await editBinaryPath(hooks)
        return
      case "terminal":
        await pickTerminal(hooks)
        return
      case "binaryPath":
        await editBinaryPath(hooks)
        return
      case "continueFromProjectRoot":
        await toggleSetting(hooks, "continueFromProjectRoot")
        return
      case "logging":
        await toggleSetting(hooks, "logging")
        return
      case "updateUri":
        await editUpdateUri(hooks)
        return
      case "updates":
        await handleUpdates()
        return
      case "diagnostics":
        showDetails()
        return
      case "terminalMode":
        await selectTerminalMode(hooks)
        return
      case "customPath":
        await editCustomPath(hooks)
        return
      case "customArgs":
        await editCustomArgs(hooks)
        return
      case "launchOptions":
        showLaunchOptions()
        return
      case "launchAdd":
        await addLaunchOption(hooks)
        return
    }
  }

  context.keymap.layer(() => ({
    mode: "base",
    enabled: () => !dialogOpen() && !applying() && !detailsOpen() && !launchOpen(),
    priority: 100,
    commands: [
      {
        id: "ocshell.dashboard.up",
        title: "Up",
        bind: "up",
        run: () => move(-1),
      },
      {
        id: "ocshell.dashboard.k",
        title: "Up",
        bind: "k",
        run: () => move(-1),
      },
      {
        id: "ocshell.dashboard.down",
        title: "Down",
        bind: "down",
        run: () => move(1),
      },
      {
        id: "ocshell.dashboard.j",
        title: "Down",
        bind: "j",
        run: () => move(1),
      },
      {
        id: "ocshell.dashboard.enter",
        title: "Change",
        bind: "return",
        run: () => activateSelected(),
      },
      {
        id: "ocshell.dashboard.refresh",
        title: "Refresh",
        bind: "r",
        run: () => {
          void refresh(true)
        },
      },
      {
        id: "ocshell.dashboard.copy",
        title: "Copy report",
        bind: "c",
        run: () => {
          void copyReport()
        },
      },
      {
        id: "ocshell.dashboard.details",
        title: "Details",
        bind: "d",
        run: () => showDetails(),
      },
      {
        id: "ocshell.dashboard.back",
        title: "Back",
        bind: "escape",
        run: () => props.onClose(),
      },
    ],
  }))

  createEffect(() => {
    const list = rows()
    if (list.length === 0) return
    if (!list.some((row) => row.id === selectedId())) setSelectedId(list[0]?.id ?? "")
  })

  createEffect(() => {
    const id = selectedId()
    queueMicrotask(() => scroll?.scrollChildIntoView(`ocshell-row-${id}`))
  })

  onMount(() => {
    const decoded = decodeCachedSnapshot(snapshotCache)
    const initial = decoded ? cachedToSnapshot(decoded) : null
    if (initial) {
      setSnapshot(initial)
      setLoading(false)
      setUpdatedAt(decoded && decoded.savedAt > 0 ? decoded.savedAt : null)
    }
    void refresh(false)
  })

  onCleanup(() => {
    disposed = true
    generation += 1
    controller?.abort()
  })

  const toneColor = (tone: RowTone) => {
    if (tone === "success") return theme().text.feedback.success.base
    if (tone === "warning") return theme().text.feedback.warning.base
    if (tone === "error") return theme().text.feedback.error.base
    if (tone === "muted") return theme().text.muted
    return theme().text.base
  }

  const RowView = (rowProps: { row: Row; selected: boolean; disabled: boolean }) => {
    const valueWidth = () => Math.max(8, width() - 4 - 2 - 22 - 1)
    const displayValue = () => {
      if (busy() && rowProps.selected) return "..."
      const value = looksLikePath(rowProps.row.value)
        ? context.ui.format.path(rowProps.row.value)
        : rowProps.row.value
      return truncateMiddle(value, valueWidth())
    }

    return (
      <box
        id={`ocshell-row-${rowProps.row.id}`}
        flexDirection="row"
        height={1}
        flexShrink={0}
        backgroundColor={rowProps.selected ? theme().background.raised.high : undefined}
        onMouseUp={() => setSelectedId(rowProps.row.id)}
      >
        <text
          fg={rowProps.selected ? theme().text.base : theme().text.muted}
          width={2}
          wrapMode="none"
        >
          {rowProps.selected ? ">" : " "}
        </text>
        <text
          fg={rowProps.disabled ? theme().text.faint : theme().text.base}
          width={22}
          wrapMode="none"
        >
          {rowProps.row.label}
        </text>
        <text
          fg={rowProps.disabled ? theme().text.faint : toneColor(rowProps.row.tone)}
          wrapMode="none"
        >
          {displayValue()}
        </text>
      </box>
    )
  }

  const Skeleton = () => (
    <box flexDirection="column" paddingX={2} paddingTop={2}>
      <For each={["Package", "Certificate", "ocshell", "opencode", "Settings"]}>
        {(label) => (
          <box flexDirection="row" height={1} flexShrink={0}>
            <text fg={theme().text.muted} width={2} wrapMode="none">
              {" "}
            </text>
            <text fg={theme().text.muted} width={18} wrapMode="none">
              {label}
            </text>
            <text fg={theme().text.faint} wrapMode="none">
              loading...
            </text>
          </box>
        )}
      </For>
      <text marginTop={1} fg={theme().text.muted}>
        [esc] back
      </text>
    </box>
  )

  const Missing = () => (
    <box flexDirection="column" padding={2} flexGrow={1}>
      <text fg={theme().text.feedback.error.base}>
        <b>ocshell.exe was not found</b>
      </text>
      <text fg={theme().text.base} marginTop={1}>
        Install Open in OpenCode, or make sure its execution alias is on PATH.
      </text>
      <text fg={theme().text.muted} marginTop={1}>
        Try this command in a terminal:
      </text>
      <text fg={theme().text.base} marginTop={1}>
        ocshell.exe version
      </text>
      <text fg={theme().text.muted} marginTop={1}>
        [r] retry  [c] copy command  [esc] back
      </text>
    </box>
  )

  const Applying = () => (
    <box flexDirection="column" padding={2} flexGrow={1}>
      <text fg={theme().text.base}>
        <b>Updating Open in OpenCode</b>
      </text>
      <text fg={theme().text.muted} marginTop={1}>
        The installer may ask for elevation. Do not close OpenCode.
      </text>
      <box flexDirection="column" flexGrow={1} marginTop={1}>
        <Show
          when={progress().length > 0}
          fallback={
            <text fg={theme().text.muted} wrapMode="none">
              Starting...
            </text>
          }
        >
          <For each={progress()}>
            {(line) => (
              <text fg={theme().text.muted} wrapMode="none">
                {truncateMiddle(line, Math.max(16, width() - 4))}
              </text>
            )}
          </For>
        </Show>
      </box>
      <text fg={theme().text.faint} marginTop={1}>
        update apply may take up to 10 minutes
      </text>
    </box>
  )

  return (
    <>
      <Show when={detailsOpen()}>
        <DiagnosticsDetail
          context={context}
          snapshot={currentSnapshot()}
          copy={copyAndReport}
          close={closeDetails}
        />
      </Show>

      <Show when={launchOpen()}>
        <LaunchManager
          context={context}
          options={() => currentSnapshot().settings?.launchOptions ?? []}
          hooks={editorHooks()}
          blocked={() => dialogOpen()}
          close={closeLaunchOptions}
        />
      </Show>

      <Show when={!detailsOpen() && !launchOpen()}>
        <box
          width="100%"
          height="100%"
          flexDirection="column"
          backgroundColor={theme().background.base}
          onSizeChange={() => setWidth(context.renderer.width)}
        >
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingX={2}
        paddingTop={1}
        flexShrink={0}
      >
        <text fg={theme().text.base} wrapMode="none">
          <b>Open in OpenCode</b>
        </text>
        <text fg={headerStatus().color} wrapMode="none">
          {width() >= 100 ? headerStatus().text : healthMarker()}
        </text>
      </box>

      <box
        border={["bottom"]}
        borderColor={theme().border.base}
        flexShrink={0}
        marginTop={1}
        height={1}
      />

      <Show when={applying()}>
        <Applying />
      </Show>

      <Show when={!applying()}>
        <Show when={loading() && !snapshot()}>
          <Skeleton />
        </Show>

        <Show when={!loading() && snapshot() && !snapshot()?.ocshellPath}>
          <Missing />
        </Show>

        <Show when={!loading() && (snapshot()?.ocshellPath || snapshot()?.doctor)}>
          <scrollbox
            ref={(value) => {
              scroll = value
            }}
            flexGrow={1}
            minHeight={0}
            paddingX={2}
            scrollbarOptions={{ visible: false }}
          >
            <For each={model().sections}>
              {(section) => (
                <box flexDirection="column" flexShrink={0} marginTop={1}>
                  <text fg={theme().text.muted} wrapMode="none">
                    {section.title}
                  </text>
                  <For each={section.rows}>
                    {(row) => (
                      <RowView
                        row={row}
                        selected={row.id === selectedId()}
                        disabled={
                          Boolean(row.disabled) || (busy() && WRITE_ACTIONS.has(row.action))
                        }
                      />
                    )}
                  </For>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
      </Show>

      <Show when={message()}>
        <text fg={theme().text.muted} paddingX={2} flexShrink={0} wrapMode="none">
          {truncateMiddle(message(), Math.max(16, width() - 4))}
        </text>
      </Show>

      <Show when={bannerError()}>
        <box
          flexDirection="row"
          justifyContent="space-between"
          paddingX={2}
          flexShrink={0}
          backgroundColor={theme().background.raised.high}
        >
          <text fg={theme().text.feedback.error.base} wrapMode="none">
            {bannerText()}
          </text>
          <text fg={theme().text.base} wrapMode="none">
            [d] details
          </text>
        </box>
      </Show>

      <box
        flexDirection="row"
        justifyContent="space-between"
        border={["top"]}
        borderColor={theme().border.base}
        paddingX={2}
        paddingTop={1}
        paddingBottom={1}
        flexShrink={0}
      >
        <text fg={theme().text.muted} wrapMode="none">
          {footerKeys()}
        </text>
        <Show when={width() >= 100 && updatedLabel()}>
          <text fg={theme().text.muted} wrapMode="none">
            {updatedLabel()}
          </text>
        </Show>
      </box>
        </box>
      </Show>
    </>
  )
}

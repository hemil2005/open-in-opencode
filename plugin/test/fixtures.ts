import { defaultLaunchOptions } from "../lib/types"
import type { Doctor, Settings, Snapshot, Terminal, UpdateInfo } from "../lib/types"

export const ocshellPath =
  "C:\\Users\\hemil\\AppData\\Local\\Microsoft\\WindowsApps\\ocshell.exe"

export const doctor: Doctor = {
  version: "0.7.0.1",
  settingsPath: "C:\\Users\\hemil\\AppData\\Roaming\\OpenInOpenCode\\settings.json",
  settingsLoaded: true,
  settingsWarning: "",
  binaryFound: true,
  binaryPath:
    "C:\\Users\\hemil\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe",
  binarySource: "npm",
  package: "OpenInOpenCode_0.7.0.1_x64__jqs6rpst54t28",
  certificate: "trusted",
  terminalCount: 8,
  terminal: "wezterm-gui",
}

export const settings: Settings = {
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
  launchOptions: defaultLaunchOptions(),
}

export const terminals: Terminal[] = [
  {
    id: "wezterm-gui",
    name: "WezTerm (GUI)",
    path: "C:\\Program Files\\WezTerm\\wezterm-gui.exe",
    supported: true,
  },
  {
    id: "git-bash",
    name: "Git Bash",
    path: "C:\\Program Files\\Git\\git-bash.exe",
    supported: false,
  },
]

export const update: UpdateInfo = {
  current: "0.7.0.1",
  available: "0.8.0.0",
  updateAvailable: true,
  bundleUri: "https://example.test/OpenInOpenCode.msix",
  installerUri: "https://example.test/OpenInOpenCode.appinstaller",
}

type SettingsOverrides = Partial<Omit<Settings, "terminal">> & {
  terminal?: Partial<Settings["terminal"]>
}

export function settingsWith(overrides: SettingsOverrides = {}): Settings {
  const { terminal, ...rest } = overrides
  return {
    ...settings,
    ...rest,
    terminal: { ...settings.terminal, ...terminal },
  }
}

export function doctorWith(overrides: Partial<Doctor>): Doctor {
  return { ...doctor, ...overrides }
}

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    ocshellPath,
    doctor,
    settings,
    terminals,
    update,
    errors: [],
    ...overrides,
  }
}

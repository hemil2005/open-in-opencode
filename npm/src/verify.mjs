import { runPowerShell } from './powershell.mjs'

/**
 * The setup reports success from Inno even when its post-install PowerShell step failed, so
 * confirm the package or classic install actually exists before telling the user it worked.
 */
export async function verifyInstalled({ runner = runPowerShell } = {}) {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'if (Get-AppxPackage OpenInOpenCode) { exit 0 }',
    "if (Test-Path (Join-Path $env:ProgramFiles 'OpenInOpenCode\\ocshell.exe')) { exit 0 }",
    'exit 1',
  ].join('; ')

  const result = await runner(script)
  return result.code === 0
}

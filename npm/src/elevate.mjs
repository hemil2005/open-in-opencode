import { CliError } from './errors.mjs'
import { runPowerShell } from './powershell.mjs'

export function buildElevatedStartCommand(targetEnv = 'OIOC_TARGET', args = []) {
  const argumentList = args.map((arg) => `'${String(arg).replace(/'/g, "''")}'`).join(', ')
  return [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath $env:${targetEnv} -ArgumentList @(${argumentList}) -Verb RunAs -Wait -PassThru`,
    'exit $process.ExitCode',
  ].join('; ')
}

export async function runElevated(
  target,
  args,
  { runner = runPowerShell, envName = 'OIOC_TARGET' } = {},
) {
  const result = await runner(buildElevatedStartCommand(envName, args), { [envName]: target })
  if (result.code === 0) return result

  const detail = String(result.stderr || '').trim()
  if (/cancel(?:l)?ed|operation was canceled/i.test(detail)) {
    throw new CliError('Administrator approval was cancelled.')
  }

  throw new CliError(
    `The elevated process exited with code ${result.code}.${detail ? `\n${detail}` : ''}`,
  )
}

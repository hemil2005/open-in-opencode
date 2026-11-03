import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { CliError, UsageError } from './errors.mjs'
import { install } from './install.mjs'
import { resolveOcshell, runOcshell } from './ocshell.mjs'
import { uninstall } from './uninstall.mjs'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

export const HELP = `Open in OpenCode — npm installer

Usage:
  open-in-opencode install [options]
  open-in-opencode doctor [--json]
  open-in-opencode settings <command> [...]
  open-in-opencode update <check|apply>
  open-in-opencode uninstall
  open-in-opencode version

Install options:
  --version <x.y.z.w>   Install a specific app release instead of the latest
  --dry-run             Print the download URLs without installing
  --base-uri <url>      Use a different release root (testing only)
  --repo <owner/name>   Use a different GitHub repository (testing only)
  -h, --help            Show this help

The npm package is a bootstrapper. The signed Open in OpenCode setup still performs the
installation and asks for administrator approval. App updates continue through the normal
package update channel.
`

export async function main(argv, deps = {}) {
  const log = deps.log || console
  const printError = (...args) => {
    if (typeof log.error === 'function') log.error(...args)
    else log.log(...args)
  }

  try {
    if (argv.length === 0 || ['help', '--help', '-h'].includes(argv[0])) {
      log.log(HELP)
      return 0
    }

    if (['version', '--version', '-v'].includes(argv[0])) {
      log.log(pkg.version)
      return 0
    }

    const [command, ...rest] = argv

    switch (command) {
      case 'install':
        return await runInstall(rest, deps, log)
      case 'doctor':
      case 'settings':
      case 'update':
        return await runOcshellCommand(command, rest, deps)
      case 'uninstall':
        return await runUninstall(rest, deps, log)
      default:
        throw new UsageError(`Unknown command "${command}". Run \`open-in-opencode --help\`.`)
    }
  } catch (error) {
    if (error instanceof CliError) {
      printError(`error: ${error.message}`)
      return error.exitCode
    }

    printError(`error: ${error?.stack || error}`)
    return 1
  }
}

async function runInstall(args, deps, log) {
  let parsed

  try {
    parsed = parseArgs({
      args,
      options: {
        version: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'base-uri': { type: 'string' },
        repo: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    })
  } catch (error) {
    throw new UsageError(error.message)
  }

  if (parsed.values.help) {
    log.log(HELP)
    return 0
  }

  const installFn = deps.install || install
  return await installFn(
    {
      version: parsed.values.version,
      dryRun: parsed.values['dry-run'],
      baseUri: parsed.values['base-uri'],
      repo: parsed.values.repo,
    },
    { ...(deps.installDeps || {}), log },
  )
}

async function runOcshellCommand(command, args, deps) {
  const resolve = deps.resolveOcshell || resolveOcshell
  const spawn = deps.runOcshell || runOcshell

  const exe = await resolve()
  if (!exe) {
    throw new CliError(
      'Open in OpenCode is not installed. Run `open-in-opencode install` first.',
      3,
    )
  }

  return spawn([command, ...args], { exe })
}

async function runUninstall(args, deps, log) {
  if (args.length > 0) {
    if (['--help', '-h'].includes(args[0])) {
      log.log(HELP)
      return 0
    }
    throw new UsageError('uninstall does not accept arguments.')
  }

  const uninstallFn = deps.uninstall || uninstall
  return await uninstallFn({ ...(deps.uninstallDeps || {}), log })
}

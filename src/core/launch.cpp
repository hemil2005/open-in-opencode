#include "core/launch.hpp"

#include <windows.h>

#include <algorithm>
#include <vector>

#include "core/binary.hpp"
#include "core/paths.hpp"
#include "core/terminals.hpp"

namespace oc {
namespace {

const Terminal* FirstSupported(const std::vector<Terminal>& terminals) {
  for (const auto& terminal : terminals) {
    if (terminal.supported && !terminal.path.empty()) return &terminal;
  }
  return nullptr;
}

}  // namespace

bool BuildLaunchPlan(const Settings& settings, const std::wstring& directory, const std::wstring& flags,
                     LaunchPlan* plan, std::wstring* error) {
  *plan = LaunchPlan();
  plan->directory = directory;

  std::wstring binary;
  std::wstring source;
  if (!ResolveBinaryPath(settings, &binary, &source)) {
    if (error) {
      *error =
          L"opencode executable not found. Install the CLI, add it to PATH, or set the "
          L"binaryPath setting (ocshell settings locate-binary).";
    }
    return false;
  }
  plan->binary = binary;

  std::vector<std::wstring> command_argv = {binary};
  for (const auto& flag : SplitArguments(flags)) command_argv.push_back(flag);

  std::vector<std::wstring> argv;

  if (settings.terminal.mode == L"default") {
    argv = command_argv;
  } else if (settings.terminal.mode == L"custom") {
    if (settings.terminal.customPath.empty()) {
      if (error) *error = L"terminal.mode is 'custom' but terminal.customPath is empty";
      return false;
    }
    if (!FileExists(settings.terminal.customPath)) {
      if (error) *error = L"custom terminal not found: " + settings.terminal.customPath;
      return false;
    }
    Terminal custom = MakeCustomTerminal(settings.terminal.customPath, settings.terminal.customArgs);
    if (!BuildTerminalArgv(custom, directory, command_argv, &argv, error)) return false;
    plan->terminalId = L"custom";
  } else {
    std::vector<Terminal> terminals = DiscoverTerminals();
    const Terminal* chosen = nullptr;

    if (!settings.terminal.id.empty()) {
      chosen = FindTerminal(terminals, settings.terminal.id);
      if (chosen && (!chosen->supported || chosen->path.empty())) chosen = nullptr;
      if (!chosen) plan->note = L"terminal '" + settings.terminal.id + L"' unavailable; using default";
    }
    if (!chosen) chosen = FirstSupported(terminals);

    if (!chosen) {
      // No terminal at all: start opencode directly and let Windows pick the console host.
      argv = command_argv;
      plan->note = L"no terminal detected; launching directly";
    } else {
      if (!BuildTerminalArgv(*chosen, directory, command_argv, &argv, error)) return false;
      plan->terminalId = chosen->id;
    }
  }

  if (argv.empty()) {
    if (error) *error = L"empty command line";
    return false;
  }

  plan->application = argv.front();
  plan->commandLine = JoinCommandLine(argv);
  return true;
}

bool ExecutePlan(const LaunchPlan& plan, std::wstring* error) {
  STARTUPINFOW startup;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);

  PROCESS_INFORMATION process;
  ZeroMemory(&process, sizeof(process));

  std::wstring mutable_command = plan.commandLine;
  const wchar_t* directory = plan.directory.empty() ? nullptr : plan.directory.c_str();

  if (!CreateProcessW(plan.application.c_str(), &mutable_command[0], nullptr, nullptr, FALSE,
                      CREATE_NEW_CONSOLE, nullptr, directory, &startup, &process)) {
    if (error) {
      wchar_t buffer[160] = {};
      std::swprintf(buffer, 160, L"CreateProcess failed, error %lu", GetLastError());
      *error = buffer;
    }
    return false;
  }

  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return true;
}

bool Launch(const Settings& settings, const std::wstring& directory, const std::wstring& flags,
            std::wstring* detail, std::wstring* error) {
  std::vector<std::wstring> arguments = SplitArguments(flags);
  std::wstring target = directory;
  std::wstring policy_note;

  // `--continue` against a folder with no session makes the TUI open with a placeholder
  // session id that fails validation (opencode#25989). Decide here so every entry point --
  // the packaged extension and the Windows 10 registry verbs -- behaves the same.
  const bool wants_continue =
      std::find(arguments.begin(), arguments.end(), L"--continue") != arguments.end();
  if (wants_continue) {
    std::wstring binary;
    std::wstring source;
    if (ResolveBinaryPath(settings, &binary, &source) && !HasSession(binary, directory)) {
      bool resolved_root = false;
      if (settings.continueFromProjectRoot) {
        std::wstring root = FindProjectRoot(directory);
        if (!root.empty() && _wcsicmp(root.c_str(), directory.c_str()) != 0 &&
            HasSession(binary, root)) {
          target = root;
          resolved_root = true;
          policy_note = L"continuing the project root session";
        }
      }
      if (!resolved_root) {
        arguments.erase(std::remove(arguments.begin(), arguments.end(), L"--continue"), arguments.end());
        policy_note = L"no session in this folder; starting a new one";
      }
    }
  }

  std::wstring effective_flags;
  for (const auto& argument : arguments) {
    if (!effective_flags.empty()) effective_flags.push_back(L' ');
    effective_flags += argument;
  }

  LaunchPlan plan;
  if (!BuildLaunchPlan(settings, target, effective_flags, &plan, error)) return false;

  if (detail) {
    *detail = L"cwd=[" + target + L"] terminal=[" + (plan.terminalId.empty() ? L"direct" : plan.terminalId) +
              L"] cmd=[" + plan.commandLine + L"]";
    if (!plan.note.empty()) *detail += L" note=[" + plan.note + L"]";
    if (!policy_note.empty()) *detail += L" policy=[" + policy_note + L"]";
  }
  return ExecutePlan(plan, error);
}

}  // namespace oc

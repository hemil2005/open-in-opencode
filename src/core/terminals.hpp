#pragma once

#include <string>
#include <vector>

namespace oc {

// A terminal we can start opencode inside.
//
// Argument templates use these placeholders:
//   {dir}          expanded to the target directory (single token)
//   {command}      expanded to the opencode argv (multiple tokens)
//   {commandline}  a single cmd.exe-quoted command line
//   {pscommand}    a single PowerShell invocation string
struct Terminal {
  std::wstring id;
  std::wstring name;
  std::wstring path;
  std::vector<std::wstring> args;
  bool supported = true;  // false = detected but we have no known-good template
};

// Probes App Paths, then PATH, for known terminals; also includes the built-in shells.
// Result order is stable so "first available" is deterministic.
std::vector<Terminal> DiscoverTerminals();

const Terminal* FindTerminal(const std::vector<Terminal>& terminals, const std::wstring& id);

bool BuildTerminalArgv(const Terminal& terminal, const std::wstring& directory,
                       const std::vector<std::wstring>& commandArgv, std::vector<std::wstring>* out,
                       std::wstring* error);

Terminal MakeCustomTerminal(const std::wstring& path, const std::vector<std::wstring>& args);

// Splits a template string on spaces, honouring double quotes.
std::vector<std::wstring> SplitArguments(const std::wstring& text);

// Joins argv into a Windows command line, quoting each argument.
std::wstring JoinCommandLine(const std::vector<std::wstring>& argv);

}  // namespace oc

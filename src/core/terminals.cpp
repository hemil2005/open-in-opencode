#include "core/terminals.hpp"

#include <windows.h>

#include "core/paths.hpp"

namespace oc {
namespace {

struct Definition {
  const wchar_t* id;
  const wchar_t* name;
  const wchar_t* exe;
  std::vector<std::wstring> args;  // empty = detected but unsupported
};

// Ordered: the picker lists the most common terminals first. No terminal is chosen automatically.
const std::vector<Definition>& Definitions() {
  static const std::vector<Definition> definitions = {
      {L"wt", L"Windows Terminal", L"wt.exe", {L"-d", L"{dir}", L"{command}"}},
      {L"alacritty", L"Alacritty", L"alacritty.exe",
       {L"--working-directory", L"{dir}", L"-e", L"{command}"}},
      {L"wezterm", L"WezTerm", L"wezterm.exe", {L"start", L"--cwd", L"{dir}", L"--", L"{command}"}},
      {L"wezterm-gui", L"WezTerm (GUI)", L"wezterm-gui.exe", {L"start", L"--cwd", L"{dir}", L"--", L"{command}"}},
      {L"kitty", L"kitty", L"kitty.exe", {L"--directory", L"{dir}", L"{command}"}},
      {L"ghostty", L"Ghostty", L"ghostty.exe",
       {L"--working-directory", L"{dir}", L"-e", L"{command}"}},
      {L"conemu", L"ConEmu", L"ConEmu64.exe", {L"-Dir", L"{dir}", L"-run", L"{commandline}"}},
      {L"mintty", L"mintty", L"mintty.exe", {L"--directory", L"{dir}", L"-e", L"{command}"}},
      // Detected for the user's information, but we do not have a verified command template.
      {L"tabby", L"Tabby", L"tabby.exe", {}},
      {L"cmder", L"Cmder", L"cmder.exe", {}},
      {L"git-bash", L"Git Bash", L"git-bash.exe", {}},
      {L"windowsterminal", L"Windows Terminal (preview)", L"WindowsTerminal.exe", {}},
      {L"rio", L"Rio", L"rio.exe", {}},
      {L"wave", L"Wave", L"wave.exe", {}},
      {L"contour", L"Contour", L"contour.exe", {}},
      {L"hyper", L"Hyper", L"hyper.exe", {}},
      {L"terminus", L"Terminus", L"terminus.exe", {}},
  };
  return definitions;
}

std::wstring Unquote(const std::wstring& text) {
  if (text.size() >= 2 && text.front() == L'"' && text.back() == L'"') {
    return text.substr(1, text.size() - 2);
  }
  return text;
}

std::wstring LookupAppPath(const std::wstring& exe) {
  const HKEY roots[] = {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
  const std::wstring subkey = L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + exe;

  for (HKEY root : roots) {
    HKEY key = nullptr;
    if (RegOpenKeyExW(root, subkey.c_str(), 0, KEY_READ, &key) != ERROR_SUCCESS) continue;

    wchar_t buffer[MAX_PATH * 2] = {};
    DWORD size = sizeof(buffer);
    DWORD type = 0;
    LONG status = RegQueryValueExW(key, nullptr, nullptr, &type, reinterpret_cast<LPBYTE>(buffer), &size);
    RegCloseKey(key);
    if (status != ERROR_SUCCESS || type != REG_SZ) continue;

    std::wstring path = Unquote(buffer);
    if (FileExists(path)) return path;
  }
  return std::wstring();
}

std::wstring LookupPath(const std::wstring& exe) {
  wchar_t buffer[MAX_PATH * 2] = {};
  DWORD length = SearchPathW(nullptr, exe.c_str(), nullptr, static_cast<DWORD>(std::size(buffer)), buffer,
                             nullptr);
  if (length == 0 || length >= std::size(buffer)) return std::wstring();
  return std::wstring(buffer, length);
}

// Terminals are frequently installed without touching PATH (MSYS2, Cygwin, Git for Windows,
// portable builds). Probe the usual roots as a last resort.
const std::vector<std::wstring>& SearchRoots() {
  static const std::vector<std::wstring> roots = [] {
    std::vector<std::wstring> out;
    auto add = [&out](const std::wstring& root) {
      if (!root.empty()) out.push_back(root);
    };
    add(EnvVar(L"ProgramFiles"));
    add(EnvVar(L"ProgramFiles(x86)"));
    add(EnvVar(L"ProgramW6432"));
    add(EnvVar(L"LOCALAPPDATA") + L"\\Programs");
    add(EnvVar(L"USERPROFILE") + L"\\scoop\\shims");
    add(EnvVar(L"ProgramData") + L"\\chocolatey\\bin");
    add(EnvVar(L"ProgramFiles") + L"\\Git");
    add(EnvVar(L"ProgramFiles") + L"\\Git\\bin");
    add(EnvVar(L"ProgramFiles") + L"\\PowerShell\\7");
    add(L"C:\\msys64\\usr\\bin");
    add(L"C:\\msys64\\mingw64\\bin");
    add(L"C:\\cygwin64\\bin");
    add(L"C:\\cygwin\\bin");
    add(L"C:\\ProgramData\\chocolatey\\bin");
    return out;
  }();
  return roots;
}

std::wstring LookupRoots(const std::wstring& exe) {
  for (const auto& root : SearchRoots()) {
    std::wstring candidate = root + L"\\" + exe;
    if (FileExists(candidate)) return candidate;
  }
  return std::wstring();
}

std::wstring ResolveExecutable(const std::wstring& exe) {
  std::wstring path = LookupAppPath(exe);
  if (!path.empty()) return path;
  path = LookupPath(exe);
  if (!path.empty()) return path;
  return LookupRoots(exe);
}

Terminal MakeTerminal(const Definition& definition, const std::wstring& path) {
  Terminal terminal;
  terminal.id = definition.id;
  terminal.name = definition.name;
  terminal.path = path;
  terminal.args = definition.args;
  terminal.supported = !definition.args.empty();
  return terminal;
}

// Built-in shells are always available and never need discovery.
Terminal Shell(const wchar_t* id, const wchar_t* name, const wchar_t* exe,
               std::vector<std::wstring> args) {
  Terminal terminal;
  terminal.id = id;
  terminal.name = name;
  terminal.path = ResolveExecutable(exe);
  terminal.args = std::move(args);
  terminal.supported = !terminal.path.empty();
  return terminal;
}

std::wstring CmdQuote(const std::wstring& value) {
  // cmd.exe has no escape for %, so a path containing one cannot be made safe here. That is
  // why shell terminals deliberately receive the executable only: the working directory is
  // set through CreateProcess and never appears on the command line.
  bool needs = value.empty();
  for (wchar_t c : value) {
    if (c == L' ' || c == L'\t' || c == L'&' || c == L'(' || c == L')' || c == L'[' || c == L']' ||
        c == L'{' || c == L'}' || c == L'^' || c == L'=' || c == L';' || c == L'!' || c == L',' ||
        c == L'`' || c == L'~') {
      needs = true;
      break;
    }
  }
  return needs ? L"\"" + value + L"\"" : value;
}

std::wstring PowerShellQuote(const std::wstring& value) {
  std::wstring out = L"'";
  for (wchar_t c : value) {
    out.push_back(c);
    if (c == L'\'') out.push_back(L'\'');
  }
  out.push_back(L'\'');
  return out;
}

}  // namespace

std::vector<Terminal> DiscoverTerminals() {
  std::vector<Terminal> terminals;

  for (const auto& definition : Definitions()) {
    std::wstring path = ResolveExecutable(definition.exe);
    if (path.empty()) continue;
    terminals.push_back(MakeTerminal(definition, path));
  }

  Terminal powershell = Shell(L"powershell", L"Windows PowerShell", L"powershell.exe",
                              {L"-NoExit", L"-Command", L"{pscommand}"});
  if (powershell.supported) terminals.push_back(powershell);

  Terminal pwsh =
      Shell(L"pwsh", L"PowerShell", L"pwsh.exe", {L"-NoExit", L"-Command", L"{pscommand}"});
  if (pwsh.supported) terminals.push_back(pwsh);

  Terminal cmd = Shell(L"cmd", L"Command Prompt", L"cmd.exe", {L"/k", L"{commandline}"});
  if (cmd.supported) terminals.push_back(cmd);

  return terminals;
}

const Terminal* FindTerminal(const std::vector<Terminal>& terminals, const std::wstring& id) {
  for (const auto& terminal : terminals) {
    if (terminal.id == id) return &terminal;
  }
  return nullptr;
}

std::vector<std::wstring> SplitArguments(const std::wstring& text) {
  std::vector<std::wstring> out;
  std::wstring current;
  bool in_quotes = false;
  for (wchar_t c : text) {
    if (c == L'"') {
      in_quotes = !in_quotes;
      continue;
    }
    if ((c == L' ' || c == L'\t') && !in_quotes) {
      if (!current.empty()) {
        out.push_back(current);
        current.clear();
      }
      continue;
    }
    current.push_back(c);
  }
  if (!current.empty()) out.push_back(current);
  return out;
}

std::wstring JoinCommandLine(const std::vector<std::wstring>& argv) {
  std::wstring out;
  for (size_t i = 0; i < argv.size(); ++i) {
    if (i) out.push_back(L' ');
    const std::wstring& value = argv[i];
    bool needs = value.empty();
    for (wchar_t c : value) {
      if (c == L' ' || c == L'\t' || c == L'"') {
        needs = true;
        break;
      }
    }
    if (!needs) {
      out += value;
      continue;
    }
    out.push_back(L'"');
    size_t backslashes = 0;
    for (wchar_t c : value) {
      if (c == L'\\') {
        ++backslashes;
        continue;
      }
      if (c == L'"') {
        out.append(backslashes * 2 + 1, L'\\');
        out.push_back(L'"');
        backslashes = 0;
        continue;
      }
      out.append(backslashes, L'\\');
      backslashes = 0;
      out.push_back(c);
    }
    out.append(backslashes * 2, L'\\');
    out.push_back(L'"');
  }
  return out;
}

Terminal MakeCustomTerminal(const std::wstring& path, const std::vector<std::wstring>& args) {
  Terminal terminal;
  terminal.id = L"custom";
  terminal.name = L"Custom terminal";
  terminal.path = path;
  terminal.args = args;
  terminal.supported = true;
  return terminal;
}

bool BuildTerminalArgv(const Terminal& terminal, const std::wstring& directory,
                       const std::vector<std::wstring>& commandArgv, std::vector<std::wstring>* out,
                       std::wstring* error) {
  if (!terminal.supported) {
    if (error) *error = L"no supported command template for terminal '" + terminal.id + L"'";
    return false;
  }
  if (terminal.path.empty()) {
    if (error) *error = L"terminal '" + terminal.id + L"' has no executable";
    return false;
  }

  out->clear();
  out->push_back(terminal.path);

  for (const auto& token : terminal.args) {
    if (token == L"{dir}") {
      out->push_back(directory);
    } else if (token == L"{command}") {
      out->insert(out->end(), commandArgv.begin(), commandArgv.end());
    } else if (token == L"{commandline}") {
      std::wstring line;
      for (size_t i = 0; i < commandArgv.size(); ++i) {
        if (i) line.push_back(L' ');
        line += CmdQuote(commandArgv[i]);
      }
      out->push_back(line);
    } else if (token == L"{pscommand}") {
      std::wstring line = L"& ";
      line += PowerShellQuote(commandArgv[0]);
      for (size_t i = 1; i < commandArgv.size(); ++i) {
        line.push_back(L' ');
        line += PowerShellQuote(commandArgv[i]);
      }
      out->push_back(line);
    } else {
      out->push_back(token);
    }
  }
  return true;
}

}  // namespace oc

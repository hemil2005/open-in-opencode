#include "core/binary.hpp"

#include <windows.h>

#include <vector>

#include "core/paths.hpp"
#include "core/terminals.hpp"

namespace oc {
namespace {

bool IsDirectory(const std::wstring& path) {
  DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

std::wstring SearchPathFor(const wchar_t* exe) {
  wchar_t buffer[MAX_PATH * 2] = {};
  DWORD length = SearchPathW(nullptr, exe, nullptr, static_cast<DWORD>(std::size(buffer)), buffer, nullptr);
  if (length == 0 || length >= std::size(buffer)) return std::wstring();
  return std::wstring(buffer, length);
}

}  // namespace

bool ResolveBinaryPath(const Settings& settings, std::wstring* path, std::wstring* source) {
  std::wstring from_env = EnvVar(L"OPENCODE_SHELL_BINARY");
  if (FileExists(from_env)) {
    *path = from_env;
    if (source) *source = L"OPENCODE_SHELL_BINARY";
    return true;
  }

  if (FileExists(settings.binaryPath)) {
    *path = settings.binaryPath;
    if (source) *source = L"settings";
    return true;
  }

  std::wstring appdata = EnvVar(L"APPDATA");
  std::wstring local = EnvVar(L"LOCALAPPDATA");
  std::wstring profile = EnvVar(L"USERPROFILE");
  std::wstring programdata = EnvVar(L"ProgramData");

  const std::vector<std::pair<std::wstring, std::wstring>> candidates = {
      {appdata + L"\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe", L"npm"},
      {profile + L"\\.opencode\\bin\\opencode.exe", L"curl installer"},
      {local + L"\\Programs\\opencode\\opencode.exe", L"local programs"},
      {profile + L"\\scoop\\shims\\opencode.exe", L"scoop"},
      {programdata + L"\\chocolatey\\bin\\opencode.exe", L"chocolatey"},
  };
  for (const auto& candidate : candidates) {
    if (FileExists(candidate.first)) {
      *path = candidate.first;
      if (source) *source = candidate.second;
      return true;
    }
  }

  std::wstring from_path = SearchPathFor(L"opencode.exe");
  if (!from_path.empty()) {
    *path = from_path;
    if (source) *source = L"PATH";
    return true;
  }

  path->clear();
  if (source) source->clear();
  return false;
}

bool HasSession(const std::wstring& binary, const std::wstring& directory) {
  if (binary.empty()) return true;  // cannot tell; let opencode decide

  std::wstring command = JoinCommandLine({binary, L"session", L"list", L"--format", L"json", L"-n", L"1"});

  SECURITY_ATTRIBUTES inherit;
  ZeroMemory(&inherit, sizeof(inherit));
  inherit.nLength = sizeof(inherit);
  inherit.bInheritHandle = TRUE;

  HANDLE read_end = nullptr;
  HANDLE write_end = nullptr;
  if (!CreatePipe(&read_end, &write_end, &inherit, 0)) return true;
  SetHandleInformation(read_end, HANDLE_FLAG_INHERIT, 0);

  HANDLE nul = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &inherit,
                           OPEN_EXISTING, 0, nullptr);

  STARTUPINFOW startup;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = nul;
  startup.hStdOutput = write_end;
  startup.hStdError = nul;

  PROCESS_INFORMATION process;
  ZeroMemory(&process, sizeof(process));
  std::wstring mutable_command = command;
  BOOL started = CreateProcessW(nullptr, &mutable_command[0], nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                                nullptr, directory.c_str(), &startup, &process);
  CloseHandle(write_end);
  if (nul != INVALID_HANDLE_VALUE) CloseHandle(nul);
  if (!started) {
    CloseHandle(read_end);
    return true;
  }

  WaitForSingleObject(process.hProcess, 3000);

  std::string output;
  char buffer[4096];
  for (;;) {
    DWORD available = 0;
    if (!PeekNamedPipe(read_end, nullptr, 0, nullptr, &available, nullptr) || available == 0) break;
    DWORD got = 0;
    if (!ReadFile(read_end, buffer, sizeof(buffer), &got, nullptr) || got == 0) break;
    output.append(buffer, got);
    if (output.size() > 64 * 1024) break;
  }
  if (WaitForSingleObject(process.hProcess, 0) == WAIT_TIMEOUT) TerminateProcess(process.hProcess, 1);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  CloseHandle(read_end);

  return output.find("\"id\"") != std::string::npos;
}

std::wstring FindProjectRoot(const std::wstring& directory) {
  if (directory.empty()) return std::wstring();

  std::wstring current = directory;
  for (;;) {
    if (FileExists(current + L"\\opencode.json") || FileExists(current + L"\\opencode.jsonc") ||
        IsDirectory(current + L"\\.opencode") || IsDirectory(current + L"\\.git") ||
        FileExists(current + L"\\.git")) {
      return current;
    }
    size_t slash = current.find_last_of(L'\\');
    if (slash == std::wstring::npos) return std::wstring();
    std::wstring parent = current.substr(0, slash);
    // "C:" -> "C:\" and stop after the drive root.
    if (parent.size() == 2 && parent[1] == L':') parent += L'\\';
    if (parent == current || parent.size() <= 3) return std::wstring();
    current = parent;
  }
}

}  // namespace oc

#include "core/plugin.hpp"

#include <vector>

#include "core/paths.hpp"

namespace oc {
namespace {

std::wstring Parent(const std::wstring& path) {
  const size_t slash = path.find_last_of(L"\\/");
  if (slash == std::wstring::npos) return std::wstring();
  return path.substr(0, slash);
}

bool DirectoryExists(const std::wstring& path) {
  if (path.empty()) return false;
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY);
}

bool EnsureDirectoryTree(const std::wstring& path) {
  if (path.empty()) return false;
  if (DirectoryExists(path)) return true;
  const std::wstring parent = Parent(path);
  if (!parent.empty() && !EnsureDirectoryTree(parent)) return false;
  if (CreateDirectoryW(path.c_str(), nullptr)) return true;
  return GetLastError() == ERROR_ALREADY_EXISTS;
}

bool RemoveTree(const std::wstring& path, std::wstring* error) {
  if (!DirectoryExists(path)) return true;

  WIN32_FIND_DATAW data;
  HANDLE find = FindFirstFileW((path + L"\\*").c_str(), &data);
  if (find == INVALID_HANDLE_VALUE) {
    // An empty directory has nothing to enumerate; remove it instead of failing.
    if (GetLastError() == ERROR_FILE_NOT_FOUND) {
      if (RemoveDirectoryW(path.c_str())) return true;
      if (error) *error = L"cannot remove " + path;
      return false;
    }
    if (error) *error = L"cannot enumerate " + path;
    return false;
  }

  bool ok = true;
  do {
    const std::wstring name = data.cFileName;
    if (name == L"." || name == L"..") continue;
    const std::wstring child = path + L"\\" + name;
    if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (!RemoveTree(child, error)) ok = false;
    } else if (!DeleteFileW(child.c_str())) {
      if (error) *error = L"cannot delete " + child;
      ok = false;
    }
  } while (FindNextFileW(find, &data));
  FindClose(find);

  if (ok && !RemoveDirectoryW(path.c_str())) {
    if (error) *error = L"cannot remove " + path;
    ok = false;
  }
  return ok;
}

bool CopyTree(const std::wstring& source, const std::wstring& target, std::wstring* error) {
  if (!DirectoryExists(source)) {
    if (error) *error = L"plugin payload not found: " + source;
    return false;
  }
  if (!EnsureDirectoryTree(target)) {
    if (error) *error = L"cannot create " + target;
    return false;
  }

  WIN32_FIND_DATAW data;
  HANDLE find = FindFirstFileW((source + L"\\*").c_str(), &data);
  if (find == INVALID_HANDLE_VALUE) {
    if (error) *error = L"cannot enumerate " + source;
    return false;
  }

  bool ok = true;
  do {
    const std::wstring name = data.cFileName;
    if (name == L"." || name == L"..") continue;
    const std::wstring from = source + L"\\" + name;
    const std::wstring to = target + L"\\" + name;
    if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (!CopyTree(from, to, error)) ok = false;
    } else if (!CopyFileW(from.c_str(), to.c_str(), FALSE)) {
      if (error) *error = L"cannot copy " + from;
      ok = false;
    }
  } while (FindNextFileW(find, &data));
  FindClose(find);
  return ok;
}

}  // namespace

std::wstring PluginInstallDirectory() {
  const std::wstring profile = EnvVar(L"USERPROFILE");
  if (profile.empty()) return std::wstring();
  return profile + L"\\.config\\opencode\\plugins\\open-in-opencode";
}

std::wstring PluginSourceDirectory(HINSTANCE instance) {
  const std::wstring module = ModulePath(instance);
  if (module.empty()) return std::wstring();
  return Parent(module) + L"\\plugin";
}

std::wstring PluginInstalledVersion(const std::wstring& target) {
  if (target.empty()) return std::wstring();
  std::wstring text;
  if (!ReadTextFile(target + L"\\.version", &text)) return std::wstring();
  while (!text.empty() &&
         (text.back() == L'\r' || text.back() == L'\n' || text.back() == L' ')) {
    text.pop_back();
  }
  return text;
}

bool InstallPlugin(const std::wstring& source, const std::wstring& target,
                   const std::wstring& version, std::wstring* error) {
  if (target.empty()) {
    if (error) *error = L"cannot resolve the opencode plugin directory";
    return false;
  }
  if (!DirectoryExists(source)) {
    if (error) {
      *error = L"plugin payload not found: " + source +
               L"\nReinstall Open in OpenCode so the packaged plugin is available.";
    }
    return false;
  }

  // Replace the directory so a renamed or deleted module cannot linger.
  if (!RemoveTree(target, error)) return false;
  if (!CopyTree(source, target, error)) return false;

  if (!WriteTextFile(target + L"\\.version", version + L"\r\n")) {
    if (error) *error = L"cannot write " + target + L"\\.version";
    return false;
  }
  return true;
}

bool UninstallPlugin(const std::wstring& target, std::wstring* error) {
  if (target.empty()) return true;
  return RemoveTree(target, error);
}

}  // namespace oc

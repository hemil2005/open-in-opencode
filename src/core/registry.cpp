#include "core/registry.hpp"

#include <windows.h>

#include <vector>

#include "core/paths.hpp"
#include "core/terminals.hpp"

namespace oc {
namespace {

// %1 is the selected folder; %V is the folder a background click happened inside.
struct Target {
  const wchar_t* key;
  const wchar_t* token;
};

const Target kTargets[] = {
    {L"Directory", L"%1"},
    {L"Directory\\Background", L"%V"},
    {L"Drive", L"%1"},
    {L"DesktopBackground", L"%V"},
};

struct Child {
  const wchar_t* key;
  const wchar_t* label;
  const wchar_t* suffix;
};

// Numeric prefixes give a deterministic order: classic submenus sort by key name.
const Child kChildren[] = {
    {L"10New", L"New session", L""},
    {L"20Continue", L"Continue last session", L" --continue"},
    {L"30Skip", L"Skip permission prompts", L" --auto"},
};

bool SetString(HKEY key, const wchar_t* name, const std::wstring& value) {
  const DWORD bytes = static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t));
  return RegSetValueExW(key, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value.c_str()), bytes) ==
         ERROR_SUCCESS;
}

std::wstring VerbRoot(const Target& target) {
  return std::wstring(L"Software\\Classes\\") + target.key + L"\\shell\\OpenCode";
}

std::wstring LaunchCommand(const std::wstring& exe, const wchar_t* token, const wchar_t* suffix) {
  // Windows substitutes the token verbatim, so it has to be quoted for paths with spaces.
  return L"\"" + exe + L"\" launch \"" + token + L"\"" + suffix;
}

}  // namespace

bool IsWindows11OrGreater() {
  // RtlGetVersion reports the real build regardless of the process manifest.
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return false;
  auto rtl_get_version = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
  if (!rtl_get_version) return false;

  RTL_OSVERSIONINFOW info;
  ZeroMemory(&info, sizeof(info));
  info.dwOSVersionInfoSize = sizeof(info);
  if (rtl_get_version(&info) != 0) return false;
  return info.dwBuildNumber >= 22000;
}

bool InstallRegistryVerbs(std::wstring* error) {
  const std::wstring exe = ModulePath(nullptr);
  if (exe.empty()) {
    if (error) *error = L"cannot determine the ocshell.exe path";
    return false;
  }

  for (const auto& target : kTargets) {
    const std::wstring root = VerbRoot(target);

    HKEY parent = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, root.c_str(), 0, nullptr, 0, KEY_WRITE, nullptr, &parent,
                        nullptr) != ERROR_SUCCESS) {
      if (error) *error = L"cannot create " + root;
      return false;
    }

    bool ok = SetString(parent, L"MUIVerb", L"Open in OpenCode") &&
              SetString(parent, L"Icon", exe + L",0") &&
              // An empty SubCommands turns the entry into a cascade built from the shell key.
              SetString(parent, L"SubCommands", L"");
    RegCloseKey(parent);
    if (!ok) {
      if (error) *error = L"cannot write values under " + root;
      return false;
    }

    for (const auto& child : kChildren) {
      const std::wstring childKey = root + L"\\shell\\" + child.key;
      HKEY key = nullptr;
      if (RegCreateKeyExW(HKEY_CURRENT_USER, childKey.c_str(), 0, nullptr, 0, KEY_WRITE, nullptr, &key,
                          nullptr) != ERROR_SUCCESS) {
        if (error) *error = L"cannot create " + childKey;
        return false;
      }
      ok = SetString(key, L"MUIVerb", child.label);
      RegCloseKey(key);
      if (!ok) {
        if (error) *error = L"cannot write MUIVerb under " + childKey;
        return false;
      }

      const std::wstring commandKey = childKey + L"\\command";
      if (RegCreateKeyExW(HKEY_CURRENT_USER, commandKey.c_str(), 0, nullptr, 0, KEY_WRITE, nullptr, &key,
                          nullptr) != ERROR_SUCCESS) {
        if (error) *error = L"cannot create " + commandKey;
        return false;
      }
      ok = SetString(key, nullptr, LaunchCommand(exe, target.token, child.suffix));
      RegCloseKey(key);
      if (!ok) {
        if (error) *error = L"cannot write the command under " + commandKey;
        return false;
      }
    }
  }

  return true;
}

bool UninstallRegistryVerbs(std::wstring* error) {
  for (const auto& target : kTargets) {
    const std::wstring root = VerbRoot(target);
    const LONG status = RegDeleteTreeW(HKEY_CURRENT_USER, root.c_str());
    if (status != ERROR_SUCCESS && status != ERROR_FILE_NOT_FOUND) {
      if (error) *error = L"cannot remove " + root;
      return false;
    }
  }
  return true;
}

bool RegistryVerbsInstalled() {
  HKEY key = nullptr;
  const LONG status =
      RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Classes\\Directory\\shell\\OpenCode", 0, KEY_READ, &key);
  if (status != ERROR_SUCCESS) return false;
  RegCloseKey(key);
  return true;
}

}  // namespace oc

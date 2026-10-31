#pragma once

#include <string>

namespace oc {

struct Settings;

bool IsWindows11OrGreater();

// Classic context-menu verbs under HKCU\Software\Classes. These work on every supported
// Windows version and are the only option on Windows 10, where the packaged modern menu does
// not exist. They appear under "Show more options" on Windows 11.
bool InstallRegistryVerbs(const Settings& settings, std::wstring* error);
bool UninstallRegistryVerbs(std::wstring* error);
bool RegistryVerbsInstalled();

}  // namespace oc

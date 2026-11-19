#pragma once

#include <windows.h>

#include <string>

namespace oc {

// %USERPROFILE%\.config\opencode\plugins\open-in-opencode
std::wstring PluginInstallDirectory();

// The packaged runtime payload: <directory of the running module>\plugin
std::wstring PluginSourceDirectory(HINSTANCE instance);

// The version recorded by the last successful install, or an empty string.
std::wstring PluginInstalledVersion(const std::wstring& target);

// Copies the packaged runtime plugin files into the user's opencode plugin directory.
// The directory is replaced wholesale so a renamed or deleted module cannot linger.
bool InstallPlugin(const std::wstring& source, const std::wstring& target,
                   const std::wstring& version, std::wstring* error);

bool UninstallPlugin(const std::wstring& target, std::wstring* error);

}  // namespace oc

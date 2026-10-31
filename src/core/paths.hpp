#pragma once

#include <windows.h>

#include <string>

namespace oc {

std::wstring EnvVar(const wchar_t* name);
std::wstring AppDataDirectory();    // %APPDATA%\OpenCodeShell
std::wstring LocalDataDirectory();  // %LOCALAPPDATA%\OpenCodeShell
std::wstring SettingsPath();        // %APPDATA%\OpenCodeShell\settings.json
std::wstring LogPath();             // %LOCALAPPDATA%\OpenCodeShell\shell.log

bool EnsureDirectory(const std::wstring& path);
bool FileExists(const std::wstring& path);
std::wstring ModulePath(HINSTANCE instance);

// UTF-8 <-> UTF-16 helpers, used at the JSON and file boundaries only.
std::string Utf8FromWide(const std::wstring& text);
std::wstring WideFromUtf8(const std::string& text);

bool ReadTextFile(const std::wstring& path, std::wstring* out);
bool WriteTextFile(const std::wstring& path, const std::wstring& text);

}  // namespace oc

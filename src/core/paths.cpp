#include "core/paths.hpp"

#include <vector>

namespace oc {
namespace {

std::wstring Join(const std::wstring& base, const wchar_t* leaf) {
  if (base.empty()) return std::wstring();
  return base + L"\\" + leaf;
}

}  // namespace

std::wstring EnvVar(const wchar_t* name) {
  wchar_t buffer[32768] = {};
  DWORD length = GetEnvironmentVariableW(name, buffer, 32768);
  if (length == 0 || length >= 32768) return std::wstring();
  return std::wstring(buffer, length);
}

std::wstring AppDataDirectory() { return Join(EnvVar(L"APPDATA"), L"OpenInOpenCode"); }

std::wstring LocalDataDirectory() { return Join(EnvVar(L"LOCALAPPDATA"), L"OpenInOpenCode"); }

std::wstring SettingsPath() { return Join(AppDataDirectory(), L"settings.json"); }

std::wstring LogPath() { return Join(LocalDataDirectory(), L"shell.log"); }

// The package was renamed from OpenCodeShell; keep reading the old folder once.
std::wstring LegacyAppDataDirectory() { return Join(EnvVar(L"APPDATA"), L"OpenCodeShell"); }

std::wstring LegacySettingsPath() { return Join(LegacyAppDataDirectory(), L"settings.json"); }

bool EnsureDirectory(const std::wstring& path) {
  if (path.empty()) return false;
  if (CreateDirectoryW(path.c_str(), nullptr)) return true;
  return GetLastError() == ERROR_ALREADY_EXISTS;
}

bool FileExists(const std::wstring& path) {
  if (path.empty()) return false;
  DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

std::wstring ModulePath(HINSTANCE instance) {
  wchar_t buffer[MAX_PATH * 2] = {};
  DWORD length = GetModuleFileNameW(instance, buffer, static_cast<DWORD>(std::size(buffer)));
  if (length == 0 || length >= std::size(buffer)) return std::wstring();
  return std::wstring(buffer, length);
}

std::string Utf8FromWide(const std::wstring& text) {
  if (text.empty()) return std::string();
  int length = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), nullptr, 0,
                                   nullptr, nullptr);
  if (length <= 0) return std::string();
  std::string out(static_cast<size_t>(length), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), &out[0], length, nullptr,
                      nullptr);
  return out;
}

std::wstring WideFromUtf8(const std::string& text) {
  if (text.empty()) return std::wstring();
  int length = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), nullptr, 0);
  if (length <= 0) return std::wstring();
  std::wstring out(static_cast<size_t>(length), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), &out[0], length);
  return out;
}

bool ReadTextFile(const std::wstring& path, std::wstring* out) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;

  std::string bytes;
  char buffer[4096];
  DWORD read = 0;
  while (ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read > 0) {
    bytes.append(buffer, read);
  }
  CloseHandle(file);
  *out = WideFromUtf8(bytes);
  return true;
}

bool WriteTextFile(const std::wstring& path, const std::wstring& text) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  std::string bytes = Utf8FromWide(text);
  DWORD written = 0;
  bool ok = WriteFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr) != FALSE;
  CloseHandle(file);
  return ok;
}

}  // namespace oc

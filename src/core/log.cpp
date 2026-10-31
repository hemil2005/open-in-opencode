#include "core/log.hpp"

#include <windows.h>

#include "core/paths.hpp"

namespace oc {
namespace {

constexpr unsigned long long kMaxLogBytes = 1024 * 1024;
bool g_verbose = false;

const wchar_t* LevelName(LogLevel level) {
  switch (level) {
    case LogLevel::Debug: return L"debug";
    case LogLevel::Info: return L"info";
    case LogLevel::Warn: return L"warn";
    case LogLevel::Error: return L"error";
  }
  return L"info";
}

void RotateIfNeeded(const std::wstring& path) {
  WIN32_FILE_ATTRIBUTE_DATA data;
  if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data)) return;
  unsigned long long size = (static_cast<unsigned long long>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
  if (size < kMaxLogBytes) return;
  std::wstring previous = path + L".1";
  DeleteFileW(previous.c_str());
  MoveFileW(path.c_str(), previous.c_str());
}

}  // namespace

void SetVerboseLogging(bool enabled) { g_verbose = enabled; }

bool VerboseLogging() { return g_verbose; }

void Log(LogLevel level, const std::wstring& message) {
  if (level == LogLevel::Debug && !g_verbose) return;

  std::wstring directory = LocalDataDirectory();
  if (directory.empty()) return;
  EnsureDirectory(directory);

  std::wstring path = LogPath();
  RotateIfNeeded(path);

  SYSTEMTIME now;
  GetLocalTime(&now);

  wchar_t prefix[64] = {};
  std::swprintf(prefix, 64, L"%04u-%02u-%02u %02u:%02u:%02u ", now.wYear, now.wMonth, now.wDay,
                now.wHour, now.wMinute, now.wSecond);

  std::wstring line = prefix;
  line += LevelName(level);
  line += L" ";
  line += message;
  line += L"\r\n";

  HANDLE file = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                            OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return;
  std::string bytes = Utf8FromWide(line);
  DWORD written = 0;
  WriteFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr);
  CloseHandle(file);
}

}  // namespace oc

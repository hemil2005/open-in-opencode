#include "core/update.hpp"

#include <windows.h>

#include <string>
#include <vector>

#include "core/http.hpp"
#include "core/paths.hpp"

namespace oc {
namespace {

bool ExtractAttribute(const std::wstring& tag, const wchar_t* name, std::wstring* out) {
  const std::wstring needle = std::wstring(name) + L"=";
  size_t position = tag.find(needle);
  if (position == std::wstring::npos) return false;
  position += needle.size();
  if (position >= tag.size()) return false;

  const wchar_t quote = tag[position];
  if (quote != L'"' && quote != L'\'') return false;
  const size_t end = tag.find(quote, position + 1);
  if (end == std::wstring::npos) return false;

  *out = tag.substr(position + 1, end - position - 1);
  return true;
}

// Attribute lookup scoped to one element, so <AppInstaller Uri> and <MainBundle Uri> cannot
// be confused with each other.
bool ExtractFromElement(const std::wstring& xml, const wchar_t* element, const wchar_t* attribute,
                        std::wstring* out) {
  size_t start = xml.find(element);
  if (start == std::wstring::npos) return false;
  size_t end = xml.find(L'>', start);
  if (end == std::wstring::npos) return false;
  return ExtractAttribute(xml.substr(start, end - start), attribute, out);
}

std::vector<int> ParseVersion(const std::wstring& text) {
  std::vector<int> parts;
  std::wstring current;
  for (wchar_t c : text) {
    if (c == L'.') {
      parts.push_back(current.empty() ? 0 : std::stoi(current));
      current.clear();
      continue;
    }
    if (c >= L'0' && c <= L'9') current.push_back(c);
  }
  parts.push_back(current.empty() ? 0 : std::stoi(current));
  while (parts.size() < 4) parts.push_back(0);
  return parts;
}

}  // namespace

int CompareVersions(const std::wstring& left, const std::wstring& right) {
  std::vector<int> a = ParseVersion(left);
  std::vector<int> b = ParseVersion(right);
  const size_t count = a.size() > b.size() ? a.size() : b.size();
  a.resize(count, 0);
  b.resize(count, 0);
  for (size_t i = 0; i < count; ++i) {
    if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

bool FetchUpdateInfo(const std::wstring& uri, UpdateInfo* info, std::wstring* error) {
  *info = UpdateInfo();

  std::string body;
  if (!HttpGet(uri, &body, error)) return false;

  const std::wstring xml = WideFromUtf8(body);

  std::wstring version;
  std::wstring bundle;
  std::wstring installer;

  if (!ExtractFromElement(xml, L"<MainBundle", L"Version", &version)) {
    if (error) *error = L"could not find <MainBundle Version> in " + uri;
    return false;
  }
  if (!ExtractFromElement(xml, L"<MainBundle", L"Uri", &bundle)) {
    if (error) *error = L"could not find <MainBundle Uri> in " + uri;
    return false;
  }
  ExtractFromElement(xml, L"<AppInstaller", L"Uri", &installer);

  info->version = version;
  info->bundleUri = bundle;
  info->installerUri = installer.empty() ? uri : installer;
  return true;
}

bool DownloadFile(const std::wstring& uri, const std::wstring& path, std::wstring* error) {
  std::string body;
  if (!HttpGet(uri, &body, error)) return false;
  if (body.empty()) {
    if (error) *error = L"empty response from " + uri;
    return false;
  }

  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    if (error) *error = L"cannot write " + path;
    return false;
  }
  DWORD written = 0;
  const BOOL ok = WriteFile(file, body.data(), static_cast<DWORD>(body.size()), &written, nullptr);
  CloseHandle(file);

  if (!ok || written != body.size()) {
    if (error) *error = L"failed writing " + path;
    return false;
  }
  return true;
}

}  // namespace oc

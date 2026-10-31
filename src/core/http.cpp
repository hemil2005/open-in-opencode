#include "core/http.hpp"

#include <windows.h>
#include <winhttp.h>

#include <vector>

namespace oc {
namespace {

struct Handle {
  HINTERNET value = nullptr;
  ~Handle() {
    if (value) WinHttpCloseHandle(value);
  }
};

bool Fail(const wchar_t* what, std::wstring* error) {
  if (error) {
    wchar_t buffer[256] = {};
    std::swprintf(buffer, 256, L"%s failed, error %lu", what, GetLastError());
    *error = buffer;
  }
  return false;
}

}  // namespace

bool HttpGet(const std::wstring& url, std::string* body, std::wstring* error) {
  body->clear();

  URL_COMPONENTS parts;
  ZeroMemory(&parts, sizeof(parts));
  parts.dwStructSize = sizeof(parts);

  wchar_t host[256] = {};
  wchar_t path[4096] = {};
  parts.lpszHostName = host;
  parts.dwHostNameLength = static_cast<DWORD>(std::size(host) - 1);
  parts.lpszUrlPath = path;
  parts.dwUrlPathLength = static_cast<DWORD>(std::size(path) - 1);

  if (!WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.size()), 0, &parts)) {
    if (error) *error = L"invalid URL: " + url;
    return false;
  }

  const std::wstring host_name(host, parts.dwHostNameLength);
  const std::wstring url_path(path, parts.dwUrlPathLength);
  const bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;

  Handle session;
  session.value = WinHttpOpen(L"OpenInOpenCode/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                              WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!session.value) return Fail(L"WinHttpOpen", error);

  Handle connection;
  connection.value = WinHttpConnect(session.value, host_name.c_str(), parts.nPort, 0);
  if (!connection.value) return Fail(L"WinHttpConnect", error);

  Handle request;
  request.value = WinHttpOpenRequest(connection.value, L"GET", url_path.c_str(), nullptr,
                                     WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                     secure ? WINHTTP_FLAG_SECURE : 0);
  if (!request.value) return Fail(L"WinHttpOpenRequest", error);

  if (!WinHttpSendRequest(request.value, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0))
    return Fail(L"WinHttpSendRequest", error);
  if (!WinHttpReceiveResponse(request.value, nullptr)) return Fail(L"WinHttpReceiveResponse", error);

  DWORD status = 0;
  DWORD size = sizeof(status);
  if (!WinHttpQueryHeaders(request.value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                           WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX))
    return Fail(L"WinHttpQueryHeaders", error);

  if (status != 200) {
    if (error) *error = L"HTTP " + std::to_wstring(status);
    return false;
  }

  for (;;) {
    DWORD available = 0;
    if (!WinHttpQueryDataAvailable(request.value, &available)) return Fail(L"WinHttpQueryDataAvailable", error);
    if (available == 0) break;

    // Guard against a malformed or hostile Content-Length.
    if (body->size() + available > 32u * 1024u * 1024u) {
      if (error) *error = L"response too large";
      return false;
    }

    std::vector<char> buffer(available);
    DWORD read = 0;
    if (!WinHttpReadData(request.value, buffer.data(), available, &read))
      return Fail(L"WinHttpReadData", error);
    if (read == 0) break;
    body->append(buffer.data(), read);
  }

  return true;
}

}  // namespace oc

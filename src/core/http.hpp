#pragma once

#include <string>

namespace oc {

// Minimal HTTPS GET used for update checks. Follows redirects (GitHub release assets
// redirect to a CDN), which is why WinHTTP is used instead of URLDownloadToFile.
bool HttpGet(const std::wstring& url, std::string* body, std::wstring* error);

}  // namespace oc

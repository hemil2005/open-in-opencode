#pragma once

#include <string>

namespace oc {

struct UpdateInfo {
  std::wstring version;      // version advertised by the .appinstaller
  std::wstring bundleUri;    // where the .msixbundle lives
  std::wstring installerUri; // the .appinstaller location (for messages)
};

// Fetches and parses an .appinstaller document.
bool FetchUpdateInfo(const std::wstring& uri, UpdateInfo* info, std::wstring* error);

// Compares dotted versions ("0.5.0.0"). Returns <0, 0 or >0.
int CompareVersions(const std::wstring& left, const std::wstring& right);

// Downloads `uri` to `path`. Binary safe.
bool DownloadFile(const std::wstring& uri, const std::wstring& path, std::wstring* error);

}  // namespace oc

#pragma once

#include <string>

#include "core/settings.hpp"

namespace oc {

// Resolves the opencode executable. `source` receives a short description of where it came
// from (env, settings, a known install path, PATH).
bool ResolveBinaryPath(const Settings& settings, std::wstring* path, std::wstring* source);

// True when the directory already has at least one opencode session. Bounded to 3 seconds.
bool HasSession(const std::wstring& binary, const std::wstring& directory);

// Walks up from `directory` looking for a project marker (.git, opencode.json, .opencode).
// Returns an empty string when nothing is found.
std::wstring FindProjectRoot(const std::wstring& directory);

}  // namespace oc

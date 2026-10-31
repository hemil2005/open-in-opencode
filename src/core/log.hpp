#pragma once

#include <string>

namespace oc {

enum class LogLevel { Debug, Info, Warn, Error };

// Debug lines are only written when logging is enabled in settings (or
// OPENCODE_SHELL_DEBUG=1). Info/Warn/Error are always written; the log rotates at 1 MB.
void Log(LogLevel level, const std::wstring& message);

void SetVerboseLogging(bool enabled);
bool VerboseLogging();

}  // namespace oc

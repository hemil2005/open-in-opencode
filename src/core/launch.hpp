#pragma once

#include <string>

#include "core/settings.hpp"

namespace oc {

struct LaunchPlan {
  std::wstring application;   // executable handed to CreateProcess
  std::wstring commandLine;   // full command line
  std::wstring directory;     // working directory
  std::wstring binary;        // resolved opencode executable
  std::wstring terminalId;    // empty when opencode is started directly
  std::wstring note;          // e.g. "requested terminal not found; using X"
};

// Builds the plan without starting anything. `flags` is a space separated argument string such
// as "--continue" or "--auto".
bool BuildLaunchPlan(const Settings& settings, const std::wstring& directory, const std::wstring& flags,
                     LaunchPlan* plan, std::wstring* error);

bool ExecutePlan(const LaunchPlan& plan, std::wstring* error);

// Build + execute. `detail` receives a one-line description for the log.
bool Launch(const Settings& settings, const std::wstring& directory, const std::wstring& flags,
            std::wstring* detail, std::wstring* error);

}  // namespace oc

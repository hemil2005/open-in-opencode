// OpenCodeShell - "Open in OpenCode" for the Windows 11 File Explorer context menu.
//
// A packaged (MSIX) IExplorerCommand hosted by a COM surrogate. Explorer loads this DLL
// only when it builds a context menu that includes our verb, so all work here must be
// cheap; the actual launch happens in Invoke().
//
// Registered item types: Directory, Directory\Background. Windows does not allow anything
// else for folder-like targets (see docs/design-notes.md).
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>

#include <string>

namespace {

// Must match <com:Class Id> in packaging/AppxManifest.xml.
const GUID kClsid = {0x6f3a1c2e, 0x5b4d, 0x4a8e, {0x9c, 0x71, 0x3d, 0x2f, 0x8b, 0x0a, 0x6e, 0x54}};

constexpr wchar_t kTitle[] = L"Open in OpenCode";
constexpr wchar_t kAppDir[] = L"OpenCodeShell";
constexpr wchar_t kLogFile[] = L"shell.log";

HINSTANCE g_instance = nullptr;

// Subcommands shown when the user expands the item. Index -1 is the parent itself.
struct Variant {
  const wchar_t *title;
  const wchar_t *args;
  const wchar_t *tip;
  // `--continue` against a folder with no session makes the TUI open with a placeholder
  // session id that fails validation (opencode#25989), so check before passing the flag.
  bool needs_session;
};

const Variant kVariants[] = {
    {L"New session", L"", L"Start a new session in this folder", false},
    {L"Continue last session", L"--continue", L"Resume the most recent session in this folder", true},
    {L"Skip permission prompts", L"--auto", L"Auto-approve permissions that are not explicitly denied", false},
};

constexpr int kParent = -1;
constexpr size_t kChildCount = sizeof(kVariants) / sizeof(kVariants[0]);

// --------------------------------------------------------------------- logging

bool DebugEnabled() {
  wchar_t value[8] = {};
  DWORD n = GetEnvironmentVariableW(L"OPENCODE_SHELL_DEBUG", value, 8);
  return n > 0 && value[0] != L'0';
}

std::wstring LogPath() {
  wchar_t base[MAX_PATH] = {};
  DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", base, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return std::wstring();
  std::wstring dir = std::wstring(base) + L"\\" + kAppDir;
  CreateDirectoryW(dir.c_str(), nullptr);
  return dir + L"\\" + kLogFile;
}

void Log(const std::wstring &text) {
  std::wstring path = LogPath();
  if (path.empty()) return;
  HANDLE file = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                            OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return;
  int len = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, nullptr, 0, nullptr, nullptr);
  if (len > 1) {
    std::string utf8(static_cast<size_t>(len - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, &utf8[0], len, nullptr, nullptr);
    utf8 += "\r\n";
    DWORD written = 0;
    WriteFile(file, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
  }
  CloseHandle(file);
}

// --------------------------------------------------------------------- helpers

std::wstring Env(const wchar_t *name) {
  wchar_t value[MAX_PATH * 4] = {};
  DWORD n = GetEnvironmentVariableW(name, value, MAX_PATH * 4);
  if (n == 0 || n >= MAX_PATH * 4) return std::wstring();
  return std::wstring(value, n);
}

bool FileExists(const std::wstring &path) {
  if (path.empty()) return false;
  DWORD attr = GetFileAttributesW(path.c_str());
  return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

std::wstring ModulePath() {
  wchar_t path[MAX_PATH * 2] = {};
  DWORD n = GetModuleFileNameW(g_instance, path, static_cast<DWORD>(std::size(path)));
  if (n == 0 || n >= std::size(path)) return std::wstring();
  return std::wstring(path, n);
}

// Quote one argument per the CommandLineToArgvW rules. A trailing backslash has to be
// doubled or it would escape the closing quote (matters for a drive root such as C:\).
std::wstring QuoteArg(const std::wstring &value) {
  std::wstring out;
  out.push_back(L'"');
  size_t backslashes = 0;
  for (wchar_t c : value) {
    if (c == L'\\') {
      ++backslashes;
      continue;
    }
    if (c == L'"') {
      out.append(backslashes * 2 + 1, L'\\');
      out.push_back(L'"');
      backslashes = 0;
      continue;
    }
    out.append(backslashes, L'\\');
    backslashes = 0;
    out.push_back(c);
  }
  out.append(backslashes * 2, L'\\');
  out.push_back(L'"');
  return out;
}

// The opencode binary lives in a different place for every install method. Probe the known
// layouts, then fall back to PATH. OPENCODE_SHELL_BINARY wins if set.
std::wstring ResolveBinary() {
  std::wstring override = Env(L"OPENCODE_SHELL_BINARY");
  if (FileExists(override)) return override;

  std::wstring appdata = Env(L"APPDATA");
  std::wstring local = Env(L"LOCALAPPDATA");
  std::wstring profile = Env(L"USERPROFILE");
  std::wstring programdata = Env(L"ProgramData");

  const std::wstring candidates[] = {
      appdata + L"\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe",  // npm -g
      profile + L"\\.opencode\\bin\\opencode.exe",                          // curl installer
      local + L"\\Programs\\opencode\\opencode.exe",
      profile + L"\\scoop\\shims\\opencode.exe",                            // scoop
      programdata + L"\\chocolatey\\bin\\opencode.exe",                     // chocolatey
  };
  for (const auto &candidate : candidates) {
    if (FileExists(candidate)) return candidate;
  }

  wchar_t found[MAX_PATH] = {};
  DWORD n = SearchPathW(nullptr, L"opencode.exe", nullptr, MAX_PATH, found, nullptr);
  if (n > 0 && n < MAX_PATH) return std::wstring(found, n);
  return std::wstring();
}

std::wstring FirstPath(IShellItemArray *items) {
  if (!items) return std::wstring();
  DWORD count = 0;
  if (FAILED(items->GetCount(&count)) || count == 0) return std::wstring();
  IShellItem *item = nullptr;
  if (FAILED(items->GetItemAt(0, &item)) || !item) return std::wstring();
  std::wstring result;
  PWSTR path = nullptr;
  if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) && path) {
    result.assign(path);
    CoTaskMemFree(path);
  }
  item->Release();
  return result;
}

// Does this folder already have a session? `session list` is scoped to the working
// directory, which is how --continue resolves its target, so the result matches.
// Bounded wait: a slow CLI must never stall Explorer's menu action.
bool HasSession(const std::wstring &directory) {
  std::wstring exe = ResolveBinary();
  if (exe.empty()) return true;  // cannot tell; let opencode decide

  std::wstring command = QuoteArg(exe) + L" session list --format json -n 1";

  SECURITY_ATTRIBUTES inherit;
  ZeroMemory(&inherit, sizeof(inherit));
  inherit.nLength = sizeof(inherit);
  inherit.bInheritHandle = TRUE;

  HANDLE read_end = nullptr;
  HANDLE write_end = nullptr;
  if (!CreatePipe(&read_end, &write_end, &inherit, 0)) return true;
  SetHandleInformation(read_end, HANDLE_FLAG_INHERIT, 0);

  HANDLE nul = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &inherit,
                           OPEN_EXISTING, 0, nullptr);

  STARTUPINFOW startup;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = nul;
  startup.hStdOutput = write_end;
  startup.hStdError = nul;

  PROCESS_INFORMATION process;
  ZeroMemory(&process, sizeof(process));
  std::wstring mutable_command = command;
  BOOL started = CreateProcessW(nullptr, &mutable_command[0], nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                                nullptr, directory.c_str(), &startup, &process);
  CloseHandle(write_end);
  if (nul != INVALID_HANDLE_VALUE) CloseHandle(nul);
  if (!started) {
    CloseHandle(read_end);
    return true;
  }

  WaitForSingleObject(process.hProcess, 3000);

  std::string output;
  char buffer[4096];
  for (;;) {
    DWORD available = 0;
    if (!PeekNamedPipe(read_end, nullptr, 0, nullptr, &available, nullptr) || available == 0) break;
    DWORD got = 0;
    if (!ReadFile(read_end, buffer, sizeof(buffer), &got, nullptr) || got == 0) break;
    output.append(buffer, got);
    if (output.size() > 64 * 1024) break;
  }
  if (WaitForSingleObject(process.hProcess, 0) == WAIT_TIMEOUT) TerminateProcess(process.hProcess, 1);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  CloseHandle(read_end);

  return output.find("\"id\"") != std::string::npos;
}

void ReportMissingBinary() {
  Log(L"error: opencode.exe not found; set OPENCODE_SHELL_BINARY to override");
  MessageBoxW(nullptr,
              L"Could not find the opencode CLI.\n\n"
              L"Install it, add it to PATH, or set the OPENCODE_SHELL_BINARY environment "
              L"variable to the full path of opencode.exe.",
              L"Open in OpenCode", MB_ICONWARNING | MB_OK);
}

void Launch(const std::wstring &directory, const wchar_t *args) {
  std::wstring exe = ResolveBinary();
  if (exe.empty()) {
    ReportMissingBinary();
    return;
  }

  std::wstring flags = (args && *args) ? (std::wstring(args) + L" ") : std::wstring();
  std::wstring command = QuoteArg(exe) + L" " + flags + QuoteArg(directory);
  Log(L"invoke: cwd=[" + directory + L"] cmd=[" + command + L"]");

  STARTUPINFOW startup;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process;
  ZeroMemory(&process, sizeof(process));

  std::wstring mutable_command = command;
  if (CreateProcessW(nullptr, &mutable_command[0], nullptr, nullptr, FALSE, CREATE_NEW_CONSOLE, nullptr,
                     directory.c_str(), &startup, &process)) {
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return;
  }

  wchar_t message[128] = {};
  _snwprintf(message, 128, L"error: CreateProcess failed, err=%lu", GetLastError());
  Log(message);
}

// ------------------------------------------------------------------ COM objects

class Command final : public IExplorerCommand {
 public:
  explicit Command(int variant) : ref_(1), variant_(variant) {}

  IFACEMETHODIMP QueryInterface(REFIID riid, void **out) override {
    if (!out) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IExplorerCommand) {
      *out = static_cast<IExplorerCommand *>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
  IFACEMETHODIMP_(ULONG) Release() override {
    ULONG remaining = InterlockedDecrement(&ref_);
    if (remaining == 0) delete this;
    return remaining;
  }

  IFACEMETHODIMP GetTitle(IShellItemArray *, PWSTR *name) override {
    const wchar_t *title = (variant_ == kParent) ? kTitle : kVariants[variant_].title;
    if (DebugEnabled()) Log(std::wstring(L"title: ") + title);
    return SHStrDupW(title, name);
  }

  IFACEMETHODIMP GetIcon(IShellItemArray *, PWSTR *icon) override {
    std::wstring module = ModulePath();
    if (module.empty()) {
      *icon = nullptr;
      return E_NOTIMPL;
    }
    // ,0 = first icon resource in this DLL (see src/resources/app.rc).
    return SHStrDupW((module + L",0").c_str(), icon);
  }

  IFACEMETHODIMP GetToolTip(IShellItemArray *, PWSTR *tip) override {
    if (variant_ == kParent) {
      *tip = nullptr;
      return E_NOTIMPL;
    }
    return SHStrDupW(kVariants[variant_].tip, tip);
  }

  IFACEMETHODIMP GetCanonicalName(GUID *guid) override {
    *guid = GUID_NULL;
    return S_OK;
  }

  IFACEMETHODIMP GetState(IShellItemArray *items, BOOL, EXPCMDSTATE *state) override {
    // Multi-select is not handled: Invoke would only act on the first folder, so hide the
    // entry rather than silently doing the wrong thing.
    DWORD count = 0;
    if (items && SUCCEEDED(items->GetCount(&count)) && count > 1) {
      *state = ECS_HIDDEN;
      return S_OK;
    }
    *state = ECS_ENABLED;
    return S_OK;
  }

  IFACEMETHODIMP GetFlags(EXPCMDFLAGS *flags) override {
    // Without ECF_HASSUBCOMMANDS the shell never expands EnumSubCommands and the cascade
    // chevron never appears.
    *flags = (variant_ == kParent) ? ECF_HASSUBCOMMANDS : ECF_DEFAULT;
    return S_OK;
  }

  IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand **commands) override {
    if (variant_ != kParent) {
      *commands = nullptr;
      return E_NOTIMPL;
    }
    *commands = new (std::nothrow) CommandEnumerator(0);
    return *commands ? S_OK : E_OUTOFMEMORY;
  }

  IFACEMETHODIMP Invoke(IShellItemArray *items, IBindCtx *) override {
    std::wstring directory = FirstPath(items);
    if (directory.empty()) {
      Log(L"error: invoke without a filesystem path");
      return S_OK;
    }

    const wchar_t *args = L"";
    if (variant_ != kParent) {
      const Variant &variant = kVariants[variant_];
      args = variant.args;
      if (variant.needs_session && !HasSession(directory)) {
        Log(L"note: --continue requested but this folder has no session; starting a new one");
        args = L"";
      }
    }

    Launch(directory, args);
    return S_OK;
  }

 private:
  class CommandEnumerator final : public IEnumExplorerCommand {
   public:
    explicit CommandEnumerator(ULONG index) : ref_(1), index_(index) {}

    IFACEMETHODIMP QueryInterface(REFIID riid, void **out) override {
      if (!out) return E_POINTER;
      if (riid == IID_IUnknown || riid == IID_IEnumExplorerCommand) {
        *out = static_cast<IEnumExplorerCommand *>(this);
        AddRef();
        return S_OK;
      }
      *out = nullptr;
      return E_NOINTERFACE;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
    IFACEMETHODIMP_(ULONG) Release() override {
      ULONG remaining = InterlockedDecrement(&ref_);
      if (remaining == 0) delete this;
      return remaining;
    }

    IFACEMETHODIMP Next(ULONG requested, IExplorerCommand **out, ULONG *fetched) override {
      ULONG taken = 0;
      while (taken < requested && index_ < kChildCount) {
        out[taken] = new (std::nothrow) Command(static_cast<int>(index_));
        if (!out[taken]) break;
        ++taken;
        ++index_;
      }
      if (fetched) *fetched = taken;
      return taken == requested ? S_OK : S_FALSE;
    }
    IFACEMETHODIMP Skip(ULONG count) override {
      index_ += count;
      if (index_ > kChildCount) index_ = kChildCount;
      return S_OK;
    }
    IFACEMETHODIMP Reset() override {
      index_ = 0;
      return S_OK;
    }
    IFACEMETHODIMP Clone(IEnumExplorerCommand **out) override {
      if (!out) return E_POINTER;
      *out = new (std::nothrow) CommandEnumerator(index_);
      return *out ? S_OK : E_OUTOFMEMORY;
    }

   private:
    ULONG ref_;
    ULONG index_;
  };

  LONG ref_;
  int variant_;
};

class Factory final : public IClassFactory {
 public:
  Factory() : ref_(1) {}

  IFACEMETHODIMP QueryInterface(REFIID riid, void **out) override {
    if (!out) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IClassFactory) {
      *out = static_cast<IClassFactory *>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref_); }
  IFACEMETHODIMP_(ULONG) Release() override {
    ULONG remaining = InterlockedDecrement(&ref_);
    if (remaining == 0) delete this;
    return remaining;
  }
  IFACEMETHODIMP CreateInstance(IUnknown *outer, REFIID riid, void **out) override {
    if (outer) return CLASS_E_NOAGGREGATION;
    Command *command = new (std::nothrow) Command(kParent);
    if (!command) return E_OUTOFMEMORY;
    HRESULT hr = command->QueryInterface(riid, out);
    command->Release();
    return hr;
  }
  IFACEMETHODIMP LockServer(BOOL) override { return S_OK; }

 private:
  LONG ref_;
};

}  // namespace

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_instance = instance;
    if (DebugEnabled()) Log(L"loaded");
  }
  return TRUE;
}

extern "C" __declspec(dllexport) HRESULT STDAPICALLTYPE DllGetClassObject(REFCLSID clsid, REFIID riid,
                                                                         void **out) {
  if (!out) return E_POINTER;
  if (!IsEqualCLSID(clsid, kClsid)) return CLASS_E_CLASSNOTAVAILABLE;
  Factory *factory = new (std::nothrow) Factory();
  if (!factory) return E_OUTOFMEMORY;
  HRESULT hr = factory->QueryInterface(riid, out);
  factory->Release();
  return hr;
}

extern "C" __declspec(dllexport) HRESULT STDAPICALLTYPE DllCanUnloadNow() { return S_FALSE; }

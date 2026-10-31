// OpenCodeShell shell extension: the packaged IExplorerCommand for the Windows 11 context menu.
// All launch logic lives in src/core so the Windows 10 registry path can reuse it.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>

#include <new>
#include <string>

#include "core/launch.hpp"
#include "core/log.hpp"
#include "core/paths.hpp"
#include "core/settings.hpp"

namespace {

// Must match <com:Class Id> in packaging/AppxManifest.xml.
const GUID kClsid = {0x6f3a1c2e, 0x5b4d, 0x4a8e, {0x9c, 0x71, 0x3d, 0x2f, 0x8b, 0x0a, 0x6e, 0x54}};

constexpr wchar_t kTitle[] = L"Open in OpenCode";
constexpr int kParent = -1;

HINSTANCE g_instance = nullptr;

struct Variant {
  const wchar_t *title;
  const wchar_t *args;
  const wchar_t *tip;
};

const Variant kVariants[] = {
    {L"New session", L"", L"Start a new session in this folder"},
    {L"Continue last session", L"--continue", L"Resume the most recent session in this folder"},
    {L"Skip permission prompts", L"--auto", L"Auto-approve permissions that are not explicitly denied"},
};
constexpr size_t kChildCount = sizeof(kVariants) / sizeof(kVariants[0]);

bool DebugEnabled() {
  wchar_t value[8] = {};
  DWORD length = GetEnvironmentVariableW(L"OPENCODE_SHELL_DEBUG", value, 8);
  if (length > 0 && value[0] != L'0') return true;
  return oc::VerboseLogging();
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

void Report(const std::wstring &message) {
  oc::Log(oc::LogLevel::Error, message);
  MessageBoxW(nullptr, message.c_str(), L"Open in OpenCode", MB_ICONWARNING | MB_OK);
}

}  // namespace

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
    if (DebugEnabled()) oc::Log(oc::LogLevel::Debug, std::wstring(L"title: ") + title);
    return SHStrDupW(title, name);
  }

  IFACEMETHODIMP GetIcon(IShellItemArray *, PWSTR *icon) override {
    std::wstring module = oc::ModulePath(g_instance);
    if (module.empty()) {
      *icon = nullptr;
      return E_NOTIMPL;
    }
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
    // Multi-select is not supported: Invoke would act on the first folder only, so hide the
    // entry rather than doing something surprising.
    DWORD count = 0;
    if (items && SUCCEEDED(items->GetCount(&count)) && count > 1) {
      *state = ECS_HIDDEN;
      return S_OK;
    }
    *state = ECS_ENABLED;
    return S_OK;
  }

  IFACEMETHODIMP GetFlags(EXPCMDFLAGS *flags) override {
    // Without ECF_HASSUBCOMMANDS the shell never calls EnumSubCommands and no chevron appears.
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
      oc::Log(oc::LogLevel::Warn, L"invoke without a filesystem path");
      return S_OK;
    }

    oc::Settings settings;
    std::wstring warning;
    oc::LoadSettings(&settings, &warning);
    oc::SetVerboseLogging(settings.logging || DebugEnabled());
    if (!warning.empty()) oc::Log(oc::LogLevel::Warn, warning);

    std::wstring args;
    if (variant_ != kParent) args = kVariants[variant_].args;

    std::wstring detail;
    std::wstring error;
    if (!oc::Launch(settings, directory, args, &detail, &error)) {
      Report(error);
      return S_OK;
    }
    oc::Log(oc::LogLevel::Info, L"launch " + detail);
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

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_instance = instance;
    DisableThreadLibraryCalls(instance);
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

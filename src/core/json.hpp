// Minimal JSON reader/writer for OpenCodeShell settings.
//
// Deliberately small: it covers the JSON subset the settings file uses (objects, arrays,
// strings, numbers, booleans, null) so the project keeps zero third-party dependencies.
#pragma once

#include <string>
#include <utility>
#include <vector>

namespace oc::json {

enum class Type { Null, Bool, Number, String, Array, Object };

class Value {
 public:
  Value();

  static Value MakeBool(bool value);
  static Value MakeNumber(double value);
  static Value MakeString(std::wstring value);
  static Value MakeArray();
  static Value MakeObject();

  Type type() const { return type_; }
  bool IsNull() const { return type_ == Type::Null; }
  bool IsObject() const { return type_ == Type::Object; }
  bool IsArray() const { return type_ == Type::Array; }
  bool IsString() const { return type_ == Type::String; }

  bool AsBool(bool fallback = false) const;
  double AsNumber(double fallback = 0.0) const;
  std::wstring AsString(std::wstring fallback = L"") const;

  const std::vector<Value>& items() const { return items_; }
  const std::vector<std::pair<std::wstring, Value>>& members() const { return members_; }
  std::vector<std::pair<std::wstring, Value>>& members() { return members_; }
  std::vector<Value>& items() { return items_; }

  const Value* Find(const std::wstring& key) const;
  // Object only. Replaces an existing member in place, otherwise appends.
  Value& Set(const std::wstring& key, Value value);
  void Push(Value value);

 private:
  Type type_ = Type::Null;
  bool bool_ = false;
  double number_ = 0.0;
  std::wstring string_;
  std::vector<Value> items_;
  std::vector<std::pair<std::wstring, Value>> members_;
};

// Returns false and fills `error` with a position on malformed input.
bool Parse(const std::wstring& text, Value* out, std::wstring* error);

// `pretty` emits two-space indentation; otherwise a single compact line.
std::wstring Write(const Value& value, bool pretty = true);

}  // namespace oc::json

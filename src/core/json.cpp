#include "core/json.hpp"

#include <cwchar>
#include <cwctype>

namespace oc::json {
namespace {

constexpr int kMaxDepth = 64;

std::wstring Escape(const std::wstring& text) {
  std::wstring out;
  out.reserve(text.size() + 8);
  for (wchar_t c : text) {
    switch (c) {
      case L'"': out += L"\\\""; break;
      case L'\\': out += L"\\\\"; break;
      case L'\b': out += L"\\b"; break;
      case L'\f': out += L"\\f"; break;
      case L'\n': out += L"\\n"; break;
      case L'\r': out += L"\\r"; break;
      case L'\t': out += L"\\t"; break;
      default:
        if (c < 0x20) {
          wchar_t buffer[8] = {};
          std::swprintf(buffer, 8, L"\\u%04x", static_cast<unsigned>(c));
          out += buffer;
        } else {
          out.push_back(c);
        }
    }
  }
  return out;
}

void Indent(std::wstring* out, int depth) { out->append(static_cast<size_t>(depth) * 2, L' '); }

std::wstring WriteValue(const Value& value, bool pretty, int depth);

std::wstring WriteNumber(double value) {
  wchar_t buffer[64] = {};
  if (value == static_cast<double>(static_cast<long long>(value)) && value > -1e15 && value < 1e15) {
    std::swprintf(buffer, 64, L"%lld", static_cast<long long>(value));
  } else {
    std::swprintf(buffer, 64, L"%.17g", value);
  }
  return buffer;
}

std::wstring WriteValue(const Value& value, bool pretty, int depth) {
  switch (value.type()) {
    case Type::Null: return L"null";
    case Type::Bool: return value.AsBool() ? L"true" : L"false";
    case Type::Number: return WriteNumber(value.AsNumber());
    case Type::String: return L"\"" + Escape(value.AsString()) + L"\"";
    case Type::Array: {
      if (value.items().empty()) return L"[]";
      std::wstring out = L"[";
      for (size_t i = 0; i < value.items().size(); ++i) {
        if (i) out += L",";
        if (pretty) {
          out += L"\n";
          Indent(&out, depth + 1);
        }
        out += WriteValue(value.items()[i], pretty, depth + 1);
      }
      if (pretty) {
        out += L"\n";
        Indent(&out, depth);
      }
      return out + L"]";
    }
    case Type::Object: {
      if (value.members().empty()) return L"{}";
      std::wstring out = L"{";
      for (size_t i = 0; i < value.members().size(); ++i) {
        if (i) out += L",";
        if (pretty) {
          out += L"\n";
          Indent(&out, depth + 1);
        }
        out += L"\"" + Escape(value.members()[i].first) + L"\":";
        if (pretty) out += L" ";
        out += WriteValue(value.members()[i].second, pretty, depth + 1);
      }
      if (pretty) {
        out += L"\n";
        Indent(&out, depth);
      }
      return out + L"}";
    }
  }
  return L"null";
}

class Parser {
 public:
  Parser(const std::wstring& text, std::wstring* error) : text_(text), error_(error) {}

  bool Run(Value* out) {
    SkipSpace();
    if (!ParseValue(out, 0)) return false;
    SkipSpace();
    if (position_ != text_.size()) return Fail(L"trailing characters");
    return true;
  }

 private:
  bool Fail(const wchar_t* message) {
    if (error_) {
      std::wstring text(message);
      text += L" at offset ";
      text += std::to_wstring(position_);
      *error_ = text;
    }
    return false;
  }

  void SkipSpace() {
    while (position_ < text_.size()) {
      wchar_t c = text_[position_];
      if (c == L' ' || c == L'\t' || c == L'\n' || c == L'\r') {
        ++position_;
      } else {
        break;
      }
    }
  }

  bool Consume(wchar_t expected) {
    if (position_ < text_.size() && text_[position_] == expected) {
      ++position_;
      return true;
    }
    return false;
  }

  bool ParseValue(Value* out, int depth) {
    if (depth > kMaxDepth) return Fail(L"nesting too deep");
    if (position_ >= text_.size()) return Fail(L"unexpected end of input");

    wchar_t c = text_[position_];
    if (c == L'{') return ParseObject(out, depth);
    if (c == L'[') return ParseArray(out, depth);
    if (c == L'"') {
      std::wstring text;
      if (!ParseString(&text)) return false;
      *out = Value::MakeString(std::move(text));
      return true;
    }
    if (c == L't' && text_.compare(position_, 4, L"true") == 0) {
      position_ += 4;
      *out = Value::MakeBool(true);
      return true;
    }
    if (c == L'f' && text_.compare(position_, 5, L"false") == 0) {
      position_ += 5;
      *out = Value::MakeBool(false);
      return true;
    }
    if (c == L'n' && text_.compare(position_, 4, L"null") == 0) {
      position_ += 4;
      *out = Value();
      return true;
    }
    return ParseNumber(out);
  }

  bool ParseNumber(Value* out) {
    size_t start = position_;
    if (position_ < text_.size() && (text_[position_] == L'-' || text_[position_] == L'+')) ++position_;
    bool digits = false;
    while (position_ < text_.size() && iswdigit(text_[position_])) {
      ++position_;
      digits = true;
    }
    if (position_ < text_.size() && text_[position_] == L'.') {
      ++position_;
      while (position_ < text_.size() && iswdigit(text_[position_])) ++position_;
    }
    if (!digits) return Fail(L"expected a number");
    if (position_ < text_.size() && (text_[position_] == L'e' || text_[position_] == L'E')) {
      ++position_;
      if (position_ < text_.size() && (text_[position_] == L'-' || text_[position_] == L'+')) ++position_;
      while (position_ < text_.size() && iswdigit(text_[position_])) ++position_;
    }
    *out = Value::MakeNumber(std::wcstod(text_.substr(start, position_ - start).c_str(), nullptr));
    return true;
  }

  bool ParseString(std::wstring* out) {
    if (!Consume(L'"')) return Fail(L"expected a string");
    out->clear();
    while (position_ < text_.size()) {
      wchar_t c = text_[position_++];
      if (c == L'"') return true;
      if (c != L'\\') {
        out->push_back(c);
        continue;
      }
      if (position_ >= text_.size()) return Fail(L"unterminated escape");
      wchar_t escape = text_[position_++];
      switch (escape) {
        case L'"': out->push_back(L'"'); break;
        case L'\\': out->push_back(L'\\'); break;
        case L'/': out->push_back(L'/'); break;
        case L'b': out->push_back(L'\b'); break;
        case L'f': out->push_back(L'\f'); break;
        case L'n': out->push_back(L'\n'); break;
        case L'r': out->push_back(L'\r'); break;
        case L't': out->push_back(L'\t'); break;
        case L'u': {
          unsigned code = 0;
          if (!ReadHex4(&code)) return false;
          // Surrogate pair: combine when a low surrogate follows.
          if (code >= 0xD800 && code <= 0xDBFF && position_ + 1 < text_.size() &&
              text_[position_] == L'\\' && text_[position_ + 1] == L'u') {
            position_ += 2;
            unsigned low = 0;
            if (!ReadHex4(&low)) return false;
            if (low >= 0xDC00 && low <= 0xDFFF) {
              unsigned combined = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
              if (combined <= 0x10FFFF) {
                wchar_t pair[2] = {};
                pair[0] = static_cast<wchar_t>(0xD800 + ((combined - 0x10000) >> 10));
                pair[1] = static_cast<wchar_t>(0xDC00 + ((combined - 0x10000) & 0x3FF));
                out->append(pair, 2);
                break;
              }
            }
            out->push_back(static_cast<wchar_t>(code));
            out->push_back(static_cast<wchar_t>(low));
            break;
          }
          out->push_back(static_cast<wchar_t>(code));
          break;
        }
        default: return Fail(L"invalid escape");
      }
    }
    return Fail(L"unterminated string");
  }

  bool ReadHex4(unsigned* out) {
    if (position_ + 4 > text_.size()) return Fail(L"truncated \\u escape");
    unsigned value = 0;
    for (int i = 0; i < 4; ++i) {
      wchar_t c = text_[position_++];
      value <<= 4;
      if (c >= L'0' && c <= L'9') value |= static_cast<unsigned>(c - L'0');
      else if (c >= L'a' && c <= L'f') value |= static_cast<unsigned>(c - L'a' + 10);
      else if (c >= L'A' && c <= L'F') value |= static_cast<unsigned>(c - L'A' + 10);
      else return Fail(L"invalid \\u escape");
    }
    *out = value;
    return true;
  }

  bool ParseArray(Value* out, int depth) {
    if (!Consume(L'[')) return false;
    *out = Value::MakeArray();
    SkipSpace();
    if (Consume(L']')) return true;
    for (;;) {
      SkipSpace();
      Value item;
      if (!ParseValue(&item, depth + 1)) return false;
      out->Push(std::move(item));
      SkipSpace();
      if (Consume(L']')) return true;
      if (!Consume(L',')) return Fail(L"expected ',' or ']'");
    }
  }

  bool ParseObject(Value* out, int depth) {
    if (!Consume(L'{')) return false;
    *out = Value::MakeObject();
    SkipSpace();
    if (Consume(L'}')) return true;
    for (;;) {
      SkipSpace();
      std::wstring key;
      if (!ParseString(&key)) return false;
      SkipSpace();
      if (!Consume(L':')) return Fail(L"expected ':'");
      SkipSpace();
      Value member;
      if (!ParseValue(&member, depth + 1)) return false;
      out->Set(key, std::move(member));
      SkipSpace();
      if (Consume(L'}')) return true;
      if (!Consume(L',')) return Fail(L"expected ',' or '}'");
    }
  }

  const std::wstring& text_;
  std::wstring* error_;
  size_t position_ = 0;
};

}  // namespace

Value::Value() = default;

Value Value::MakeBool(bool value) {
  Value out;
  out.type_ = Type::Bool;
  out.bool_ = value;
  return out;
}

Value Value::MakeNumber(double value) {
  Value out;
  out.type_ = Type::Number;
  out.number_ = value;
  return out;
}

Value Value::MakeString(std::wstring value) {
  Value out;
  out.type_ = Type::String;
  out.string_ = std::move(value);
  return out;
}

Value Value::MakeArray() {
  Value out;
  out.type_ = Type::Array;
  return out;
}

Value Value::MakeObject() {
  Value out;
  out.type_ = Type::Object;
  return out;
}

bool Value::AsBool(bool fallback) const { return type_ == Type::Bool ? bool_ : fallback; }

double Value::AsNumber(double fallback) const { return type_ == Type::Number ? number_ : fallback; }

std::wstring Value::AsString(std::wstring fallback) const {
  return type_ == Type::String ? string_ : std::move(fallback);
}

const Value* Value::Find(const std::wstring& key) const {
  if (type_ != Type::Object) return nullptr;
  for (const auto& member : members_) {
    if (member.first == key) return &member.second;
  }
  return nullptr;
}

Value& Value::Set(const std::wstring& key, Value value) {
  for (auto& member : members_) {
    if (member.first == key) {
      member.second = std::move(value);
      return member.second;
    }
  }
  members_.emplace_back(key, std::move(value));
  return members_.back().second;
}

void Value::Push(Value value) { items_.push_back(std::move(value)); }

bool Parse(const std::wstring& text, Value* out, std::wstring* error) {
  Parser parser(text, error);
  return parser.Run(out);
}

std::wstring Write(const Value& value, bool pretty) { return WriteValue(value, pretty, 0); }

}  // namespace oc::json

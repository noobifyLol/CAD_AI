"""Tokenizer for Onshape FeatureScript."""
import re

KEYWORDS = {
    "FeatureScript", "import", "export", "function", "predicate", "operator", "type", "typecheck",
    "enum", "const", "var", "return", "if", "else", "for", "while", "in", "break", "continue",
    "throw", "try", "silent", "catch", "switch", "is", "as", "new", "box", "true", "false",
    "undefined", "returns", "precondition", "annotation",
}

PUNCT = [
    "...", "=>", "->", "?.", "==", "!=", "<=", ">=", "&&", "||", "??", "+=", "-=", "*=", "/=", "~=", "%=", "^=",
    "+", "-", "*", "/", "%", "^", "~", "<", ">", "=", "!", "?", ":", ";", ",", ".", "(", ")", "[", "]",
    "{", "}", "@",
]

_TOKEN_RE = re.compile(
    r"""
    (?P<ws>[ \t\r\n﻿]+)
  | (?P<lcomment>//[^\n]*)
  | (?P<bcomment>/\*.*?\*/)
  | (?P<number>(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)
  | (?P<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
  | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<punct>""" + "|".join(re.escape(p) for p in PUNCT) + r""")
  | (?P<other>.)
    """,
    re.S | re.X,
)

_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'", "/": "/", "0": "\0"}


class Token:
    __slots__ = ("kind", "value", "line", "col")

    def __init__(self, kind, value, line, col):
        self.kind, self.value, self.line, self.col = kind, value, line, col

    def __repr__(self):
        return f"Token({self.kind},{self.value!r},{self.line}:{self.col})"


class FSSyntaxError(Exception):
    def __init__(self, message, line=None, col=None, source=None):
        super().__init__(f"{source or '<code>'}:{line}:{col}: {message}" if line else message)
        self.message, self.line, self.col, self.source = message, line, col, source


def _unescape(body):
    out, i = [], 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt == "u" and i + 5 < len(body):
                out.append(chr(int(body[i + 2:i + 6], 16)))
                i += 6
                continue
            out.append(_ESCAPES.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def tokenize(text, source=None):
    tokens = []
    line, line_start = 1, 0
    for match in _TOKEN_RE.finditer(text):
        kind = match.lastgroup
        value = match.group()
        col = match.start() - line_start + 1
        if kind in ("ws", "lcomment", "bcomment"):
            pass
        elif kind == "number":
            tokens.append(Token("number", float(value), line, col))
        elif kind == "string":
            tokens.append(Token("string", _unescape(value[1:-1]), line, col))
        elif kind == "ident":
            tokens.append(Token("kw" if value in KEYWORDS else "ident", value, line, col))
        elif kind == "punct":
            tokens.append(Token("punct", value, line, col))
        else:
            # Non-ASCII outside strings/comments (e.g. the ✨ version marker) — keep as a word.
            if value.strip():
                tokens.append(Token("other", value, line, col))
        newlines = value.count("\n")
        if newlines:
            line += newlines
            line_start = match.start() + value.rfind("\n") + 1
    tokens.append(Token("eof", None, line, 1))
    return tokens

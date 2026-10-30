"""Recursive-descent parser for Onshape FeatureScript → AST (tuples of node classes)."""
from .lexer import FSSyntaxError, tokenize


class Node:
    __slots__ = ("line",)
    fields = ()

    def __init__(self, *args, line=None):
        for name, value in zip(self.fields, args):
            setattr(self, name, value)
        self.line = line

    def __repr__(self):
        return f"{type(self).__name__}({', '.join(f'{f}={getattr(self, f)!r}' for f in self.fields)})"


def node(name, *fields):
    return type(name, (Node,), {"__slots__": fields, "fields": fields})


# ── module level ──
Module = node("Module", "items", "imports", "source")
Import = node("Import", "path", "exported")
ConstDecl = node("ConstDecl", "name", "type", "expr", "exported")
FunctionDecl = node("FunctionDecl", "name", "params", "returns", "precondition", "body", "exported", "kind")
TypeDecl = node("TypeDecl", "name", "predicate", "exported")
EnumDecl = node("EnumDecl", "name", "values", "exported")
Param = node("Param", "name", "type")

# ── statements ──
Block = node("Block", "stmts")
VarDecl = node("VarDecl", "decls", "const")  # decls: [(name, type, expr)]
If = node("If", "cond", "then", "orelse")
ForC = node("ForC", "init", "cond", "step", "body")
ForIn = node("ForIn", "key", "value", "iterable", "body")
While = node("While", "cond", "body")
Return = node("Return", "expr")
Break = node("Break")
Continue = node("Continue")
Throw = node("Throw", "expr")
Try = node("Try", "silent", "body", "catch_name", "catch_body")
ExprStmt = node("ExprStmt", "expr")
Annotated = node("Annotated", "annotation", "stmt")

# ── expressions ──
Num = node("Num", "value")
Str = node("Str", "value")
Bool = node("Bool", "value")
Undef = node("Undef")
Name = node("Name", "name")
ArrayLit = node("ArrayLit", "items")
MapLit = node("MapLit", "entries")  # [(key_expr, value_expr)]
Lambda = node("Lambda", "params", "returns", "precondition", "body", "is_expr")
Call = node("Call", "func", "args")
PipeCall = node("PipeCall", "target", "func", "args")  # a->f(b)
Builtin = node("Builtin", "name", "args")
Member = node("Member", "obj", "name", "optional")
Index = node("Index", "obj", "index")
BoxDeref = node("BoxDeref", "obj")
NewBox = node("NewBox", "expr")
Unary = node("Unary", "op", "expr")
Binary = node("Binary", "op", "left", "right")
Logical = node("Logical", "op", "left", "right")
Ternary = node("Ternary", "cond", "then", "orelse")
IsType = node("IsType", "expr", "type")
AsType = node("AsType", "expr", "type")
Assign = node("Assign", "op", "target", "expr")
TryExpr = node("TryExpr", "silent", "expr")
Switch = node("Switch", "expr", "cases")  # cases: [(key_expr, value_expr)]

TYPE_WORDS = {"box", "undefined", "function"}
BINARY_LEVELS = [
    ("??",),
    ("||",),
    ("&&",),
    ("==", "!="),
    ("<", ">", "<=", ">=", "is"),
    ("~",),
    ("+", "-"),
    ("*", "/", "%"),
]
ASSIGN_OPS = {"=", "+=", "-=", "*=", "/=", "~=", "%=", "^="}


class Parser:
    def __init__(self, text, source=None):
        self.source = source
        self.tokens = tokenize(text, source)
        self.pos = 0

    # ── helpers ──
    @property
    def tok(self):
        return self.tokens[self.pos]

    def peek(self, offset=1):
        return self.tokens[min(self.pos + offset, len(self.tokens) - 1)]

    def error(self, message, tok=None):
        tok = tok or self.tok
        raise FSSyntaxError(f"{message} (found {tok.value!r})", tok.line, tok.col, self.source)

    def at(self, value, kind=None):
        tok = self.tok
        return tok.value == value and (kind is None or tok.kind == kind) and tok.kind in ("punct", "kw")

    def accept(self, value):
        if self.at(value):
            self.pos += 1
            return True
        return False

    def expect(self, value):
        if not self.at(value):
            self.error(f"expected {value!r}")
        tok = self.tok
        self.pos += 1
        return tok

    def ident(self):
        tok = self.tok
        if tok.kind == "ident" or (tok.kind == "kw" and tok.value in ("type", "silent", "box", "returns", "operator", "predicate")):
            self.pos += 1
            return tok.value
        self.error("expected identifier")

    def type_name(self):
        tok = self.tok
        if tok.kind == "ident" or (tok.kind == "kw" and tok.value in TYPE_WORDS):
            self.pos += 1
            return tok.value
        self.error("expected type name")

    # ── module ──
    def parse_module(self):
        items, imports = [], []
        if self.at("FeatureScript"):
            self.pos += 1
            while not self.at(";"):
                self.pos += 1
            self.expect(";")
        while self.tok.kind != "eof":
            if self.accept(";"):
                continue
            item = self.parse_item()
            if isinstance(item, Import):
                imports.append(item)
            elif item is not None:
                items.append(item)
        return Module(items, imports, self.source)

    def skip_annotation(self):
        self.expect("annotation")
        self.parse_map_literal()

    def parse_item(self):
        line = self.tok.line
        while self.at("annotation"):
            self.skip_annotation()
        exported = self.accept("export")
        if self.at("import"):
            self.pos += 1
            self.expect("(")
            path = None
            while not self.at(")"):
                key = self.ident()
                self.expect(":")
                value = self.parse_expr()
                if key == "path" and isinstance(value, Str):
                    path = value.value
                self.accept(",")
            self.expect(")")
            self.expect(";")
            return Import(path, exported, line=line)
        if self.at("const"):
            self.pos += 1
            name = self.ident()
            type_ = self.type_name() if self.accept("is") else None
            self.expect("=")
            expr = self.parse_expr()
            self.expect(";")
            return ConstDecl(name, type_, expr, exported, line=line)
        if self.at("function") or self.at("predicate") or self.at("operator"):
            kind = self.tok.value
            self.pos += 1
            if kind == "operator":
                name = "operator" + self.tok.value
                self.pos += 1
            else:
                name = self.ident()
            params = self.parse_params()
            returns = self.type_name() if self.accept("returns") else None
            precondition = self.parse_precondition()
            body = self.parse_block()
            return FunctionDecl(name, params, returns, precondition, body, exported, kind, line=line)
        if self.at("type"):
            self.pos += 1
            name = self.ident()
            self.expect("typecheck")
            predicate = self.ident()
            self.expect(";")
            return TypeDecl(name, predicate, exported, line=line)
        if self.at("enum"):
            self.pos += 1
            name = self.ident()
            self.expect("{")
            values = []
            while not self.at("}"):
                while self.at("annotation"):
                    self.skip_annotation()
                values.append(self.ident())
                if not self.accept(","):
                    break
            self.expect("}")
            return EnumDecl(name, values, exported, line=line)
        self.error("expected a top-level declaration")

    def parse_params(self):
        self.expect("(")
        params = []
        while not self.at(")"):
            name = self.ident()
            type_ = self.type_name() if self.accept("is") else None
            params.append(Param(name, type_))
            if not self.accept(","):
                break
        self.expect(")")
        return params

    def parse_precondition(self):
        if not self.accept("precondition"):
            return None
        if self.at("{"):
            return self.parse_block()
        stmt = self.parse_statement()
        return Block([stmt], line=stmt.line)

    # ── statements ──
    def parse_block(self):
        line = self.expect("{").line
        stmts = []
        while not self.at("}"):
            if self.tok.kind == "eof":
                self.error("unterminated block")
            stmts.append(self.parse_statement())
        self.expect("}")
        return Block(stmts, line=line)

    def parse_var_decl(self):
        const = self.tok.value == "const"
        line = self.tok.line
        self.pos += 1
        decls = []
        while True:
            name = self.ident()
            type_ = self.type_name() if self.accept("is") else None
            expr = self.parse_expr() if self.accept("=") else None
            decls.append((name, type_, expr))
            if not self.accept(","):
                break
        return VarDecl(decls, const, line=line)

    def parse_statement(self):
        tok = self.tok
        line = tok.line
        if tok.kind == "punct" and tok.value == "{":
            # A block, unless it is an expression statement starting with a map literal.
            return self.parse_block()
        if tok.kind == "punct" and tok.value == ";":
            self.pos += 1
            return Block([], line=line)
        if tok.kind == "kw":
            word = tok.value
            if word == "annotation":
                self.pos += 1
                annotation = self.parse_map_literal()
                if self.at("}"):
                    return Block([], line=line)
                return Annotated(annotation, self.parse_statement(), line=line)
            if word in ("var", "const"):
                decl = self.parse_var_decl()
                self.expect(";")
                return decl
            if word == "if":
                self.pos += 1
                self.expect("(")
                cond = self.parse_expr()
                self.expect(")")
                then = self.parse_statement()
                orelse = self.parse_statement() if self.accept("else") else None
                return If(cond, then, orelse, line=line)
            if word == "for":
                self.pos += 1
                self.expect("(")
                if self.at("var") or self.at("const"):
                    save = self.pos
                    self.pos += 1
                    first = self.ident()
                    second = None
                    if self.accept(","):
                        second = self.ident()
                    if self.accept("in"):
                        iterable = self.parse_expr()
                        self.expect(")")
                        body = self.parse_statement()
                        return ForIn(first if second else None, second or first, iterable, body, line=line)
                    self.pos = save
                    init = self.parse_var_decl()
                elif self.tok.kind == "ident" and self.peek().value in ("in", ","):
                    first = self.ident()
                    second = self.ident() if self.accept(",") else None
                    self.expect("in")
                    iterable = self.parse_expr()
                    self.expect(")")
                    body = self.parse_statement()
                    return ForIn(first if second else None, second or first, iterable, body, line=line)
                else:
                    init = None if self.at(";") else ExprStmt(self.parse_expr(), line=line)
                self.expect(";")
                cond = None if self.at(";") else self.parse_expr()
                self.expect(";")
                step = None if self.at(")") else self.parse_expr()
                self.expect(")")
                body = self.parse_statement()
                return ForC(init, cond, step, body, line=line)
            if word == "while":
                self.pos += 1
                self.expect("(")
                cond = self.parse_expr()
                self.expect(")")
                return While(cond, self.parse_statement(), line=line)
            if word == "return":
                self.pos += 1
                expr = None if self.at(";") else self.parse_expr()
                self.expect(";")
                return Return(expr, line=line)
            if word == "break":
                self.pos += 1
                self.expect(";")
                return Break(line=line)
            if word == "continue":
                self.pos += 1
                self.expect(";")
                return Continue(line=line)
            if word == "throw":
                self.pos += 1
                expr = self.parse_expr()
                self.expect(";")
                return Throw(expr, line=line)
            if word == "try" and (self.peek().value == "{" or (self.peek().value == "silent" and self.peek(2).value == "{")):
                self.pos += 1
                silent = self.accept("silent")
                body = self.parse_block()
                catch_name, catch_body = None, None
                if self.accept("catch"):
                    if self.accept("("):
                        catch_name = self.ident()
                        self.expect(")")
                    catch_body = self.parse_block()
                return Try(silent, body, catch_name, catch_body, line=line)
        expr = self.parse_expr()
        self.expect(";")
        return ExprStmt(expr, line=line)

    # ── expressions ──
    def parse_expr(self):
        return self.parse_assign()

    def parse_assign(self):
        left = self.parse_ternary()
        tok = self.tok
        if tok.kind == "punct" and tok.value in ASSIGN_OPS:
            self.pos += 1
            right = self.parse_assign()
            return Assign(tok.value, left, right, line=tok.line)
        return left

    def parse_ternary(self):
        cond = self.parse_binary(0)
        if self.at("?"):
            line = self.tok.line
            self.pos += 1
            then = self.parse_assign()
            self.expect(":")
            orelse = self.parse_assign()
            return Ternary(cond, then, orelse, line=line)
        return cond

    def parse_binary(self, level):
        if level == len(BINARY_LEVELS):
            return self.parse_unary()
        ops = BINARY_LEVELS[level]
        left = self.parse_binary(level + 1)
        while self.tok.kind in ("punct", "kw") and self.tok.value in ops:
            tok = self.tok
            self.pos += 1
            if tok.value == "is":
                left = IsType(left, self.type_name(), line=tok.line)
                continue
            right = self.parse_binary(level + 1)
            if tok.value in ("&&", "||", "??"):
                left = Logical(tok.value, left, right, line=tok.line)
            else:
                left = Binary(tok.value, left, right, line=tok.line)
        return left

    def parse_unary(self):
        tok = self.tok
        if tok.kind == "punct" and tok.value in ("-", "!", "+"):
            self.pos += 1
            operand = self.parse_unary()
            return operand if tok.value == "+" else Unary(tok.value, operand, line=tok.line)
        return self.parse_power()

    def parse_power(self):
        base = self.parse_postfix()
        if self.at("^"):
            line = self.tok.line
            self.pos += 1
            exponent = self.parse_unary()  # right associative, allows 2 ^ -1
            return Binary("^", base, exponent, line=line)
        return base

    def parse_args(self):
        self.expect("(")
        args = []
        while not self.at(")"):
            args.append(self.parse_expr())
            if not self.accept(","):
                break
        self.expect(")")
        return args

    def parse_postfix(self):
        expr = self.parse_primary()
        while True:
            tok = self.tok
            if tok.kind == "punct" and tok.value == "(":
                expr = Call(expr, self.parse_args(), line=tok.line)
            elif tok.kind == "punct" and tok.value == ".":
                self.pos += 1
                name_tok = self.tok
                if name_tok.kind not in ("ident", "kw"):
                    self.error("expected member name")
                self.pos += 1
                expr = Member(expr, name_tok.value, False, line=tok.line)
            elif tok.kind == "punct" and tok.value == "?.":
                self.pos += 1
                name_tok = self.tok
                self.pos += 1
                expr = Member(expr, name_tok.value, True, line=tok.line)
            elif tok.kind == "punct" and tok.value == "[":
                self.pos += 1
                if self.accept("]"):
                    expr = BoxDeref(expr, line=tok.line)
                else:
                    index = self.parse_expr()
                    self.expect("]")
                    expr = Index(expr, index, line=tok.line)
            elif tok.kind == "punct" and tok.value == "->":
                self.pos += 1
                func = self.parse_primary_name_or_member()
                expr = PipeCall(expr, func, self.parse_args(), line=tok.line)
            elif tok.kind == "kw" and tok.value == "as":
                self.pos += 1
                expr = AsType(expr, self.type_name(), line=tok.line)
            else:
                return expr

    def parse_primary_name_or_member(self):
        expr = Name(self.ident(), line=self.tok.line)
        while self.at("."):
            self.pos += 1
            expr = Member(expr, self.ident(), False, line=self.tok.line)
        return expr

    def is_arrow_lambda(self):
        # ( a, b ) => ...   or   ident => ...
        tok = self.tok
        if tok.kind == "ident" and self.peek().value == "=>":
            return True
        if tok.value != "(" or tok.kind != "punct":
            return False
        depth, i = 0, self.pos
        while i < len(self.tokens):
            t = self.tokens[i]
            if t.kind == "punct" and t.value == "(":
                depth += 1
            elif t.kind == "punct" and t.value == ")":
                depth -= 1
                if depth == 0:
                    nxt = self.tokens[i + 1]
                    if nxt.kind == "kw" and nxt.value == "returns":
                        nxt = self.tokens[i + 3]
                    return nxt.kind == "punct" and nxt.value == "=>"
            elif depth == 1 and not (t.kind in ("ident",) or (t.kind == "punct" and t.value == ",") or (t.kind == "kw" and t.value in ("is",) + tuple(TYPE_WORDS))):
                return False
            i += 1
        return False

    def parse_arrow_lambda(self):
        line = self.tok.line
        if self.tok.kind == "ident":
            params = [Param(self.ident(), None)]
        else:
            params = self.parse_params()
        returns = self.type_name() if self.accept("returns") else None
        self.expect("=>")
        if self.at("{") and not self.looks_like_map():
            return Lambda(params, returns, None, self.parse_block(), False, line=line)
        return Lambda(params, returns, None, self.parse_assign(), True, line=line)

    def looks_like_map(self):
        # "{ "key" : ..." / "{ key : ..." / "{}" after => is a map literal, not a block.
        first, second = self.peek(1), self.peek(2)
        if first.kind == "punct" and first.value == "}":
            return True
        if first.kind in ("string", "ident", "number") and second.kind == "punct" and second.value == ":":
            return True
        return first.kind == "punct" and first.value == "("

    def parse_map_literal(self):
        line = self.expect("{").line
        entries = []
        while not self.at("}"):
            tok = self.tok
            if tok.kind in ("ident", "kw") and self.peek().value == ":" and self.peek().kind == "punct":
                self.pos += 1
                key = Str(tok.value, line=tok.line)
            elif tok.kind == "string" and self.peek().kind == "punct" and self.peek().value == ":":
                self.pos += 1
                key = Str(tok.value, line=tok.line)
            else:
                key = self.parse_ternary()
            self.expect(":")
            entries.append((key, self.parse_expr()))
            if not self.accept(","):
                break
        self.expect("}")
        return MapLit(entries, line=line)

    def parse_primary(self):
        tok = self.tok
        line = tok.line
        kind, value = tok.kind, tok.value
        if kind == "number":
            self.pos += 1
            return Num(value, line=line)
        if kind == "string":
            self.pos += 1
            return Str(value, line=line)
        if kind == "ident":
            if self.peek().kind == "punct" and self.peek().value == "=>":
                return self.parse_arrow_lambda()
            self.pos += 1
            if value == "inf":
                return Num(float("inf"), line=line)
            return Name(value, line=line)
        if kind == "kw":
            if value in ("true", "false"):
                self.pos += 1
                return Bool(value == "true", line=line)
            if value == "undefined":
                self.pos += 1
                return Undef(line=line)
            if value == "function":
                self.pos += 1
                params = self.parse_params()
                returns = self.type_name() if self.accept("returns") else None
                precondition = self.parse_precondition()
                return Lambda(params, returns, precondition, self.parse_block(), False, line=line)
            if value == "new":
                self.pos += 1
                self.expect("box")
                self.expect("(")
                expr = self.parse_expr()
                self.expect(")")
                return NewBox(expr, line=line)
            if value == "try":
                self.pos += 1
                silent = self.accept("silent")
                self.expect("(")
                expr = self.parse_expr()
                self.expect(")")
                return TryExpr(silent, expr, line=line)
            if value == "switch":
                self.pos += 1
                self.expect("(")
                subject = self.parse_expr()
                self.expect(")")
                cases = self.parse_map_literal().entries
                return Switch(subject, cases, line=line)
            if value in ("box", "type", "silent", "returns"):
                self.pos += 1
                return Name(value, line=line)
        if kind == "punct":
            if value == "@":
                self.pos += 1
                name = self.ident()
                return Builtin(name, self.parse_args(), line=line)
            if value == "(":
                if self.is_arrow_lambda():
                    return self.parse_arrow_lambda()
                self.pos += 1
                expr = self.parse_expr()
                self.expect(")")
                return expr
            if value == "[":
                self.pos += 1
                items = []
                while not self.at("]"):
                    items.append(self.parse_expr())
                    if not self.accept(","):
                        break
                self.expect("]")
                return ArrayLit(items, line=line)
            if value == "{":
                return self.parse_map_literal()
        self.error("unexpected token")


def parse(text, source=None):
    return Parser(text, source).parse_module()

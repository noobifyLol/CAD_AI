"""Tree-walking interpreter for FeatureScript that runs the real Onshape std library.

Native `@builtins` are provided by fs_sim.natives (math/containers/strings) and
fs_sim.geom (sketches, operations, queries, evaluation on OpenCascade).
"""
import glob
import hashlib
import math
import os
import pickle
import sys

from . import parser as P
from .values import Box, Builtin, EnumValue, FSMap, Tagged, fs_str, is_number, untag

sys.setrecursionlimit(100000)

BASE_TYPES = {"number", "string", "boolean", "array", "map", "function", "box", "undefined", "builtin"}


class FSError(Exception):
    """A FeatureScript runtime error (what Onshape would report as a feature error)."""

    def __init__(self, message, value=None, line=None, source=None):
        super().__init__(message)
        self.message = message
        self.value = value
        self.line = line
        self.source = source
        self.trace = []

    def __str__(self):
        where = f" [{self.source}:{self.line}]" if self.line else ""
        return f"{self.message}{where}"


class SimulatorGap(Exception):
    """The simulator does not implement something (not a fault in the FeatureScript)."""


class Signal:
    __slots__ = ("kind", "value")

    def __init__(self, kind, value=None):
        self.kind, self.value = kind, value


BREAK = Signal("break")
CONTINUE = Signal("continue")


class Closure:
    __slots__ = ("params", "body", "env", "precondition", "returns", "name", "is_expr", "module", "kind", "source")

    def __init__(self, params, body, env, precondition=None, returns=None, name="<lambda>", is_expr=False, module=None, kind="function"):
        self.params, self.body, self.env = params, body, env
        self.precondition, self.returns, self.name = precondition, returns, name
        self.is_expr, self.module, self.kind = is_expr, module, kind
        self.source = module.name if module is not None else None

    def __repr__(self):
        return f"<function {self.name}>"


class Native:
    __slots__ = ("name", "fn")

    def __init__(self, name, fn):
        self.name, self.fn = name, fn

    def __repr__(self):
        return f"<native {self.name}>"


class OverloadSet:
    __slots__ = ("name", "closures")

    def __init__(self, name, closures):
        self.name, self.closures = name, closures

    def __repr__(self):
        return f"<function {self.name} ({len(self.closures)} overloads)>"


class Env:
    __slots__ = ("vars", "parent")

    def __init__(self, parent=None):
        self.vars = {}
        self.parent = parent

    def lookup(self, name):
        env = self
        while env is not None:
            if isinstance(env, Env):
                if name in env.vars:
                    return env.vars[name]
                env = env.parent
            else:
                return env.lookup(name)
        raise KeyError(name)

    def assign(self, name, value):
        env = self
        while isinstance(env, Env):
            if name in env.vars:
                env.vars[name] = value
                return
            env = env.parent
        raise KeyError(name)


class ModuleInfo:
    def __init__(self, name, ast):
        self.name = name
        self.ast = ast
        self.functions = {}  # name -> [FunctionDecl]
        self.consts = {}     # name -> ConstDecl
        self.types = {}      # name -> TypeDecl | EnumDecl
        self.exported = set()
        self.const_values = {}
        self.scope = None
        for item in ast.items:
            if isinstance(item, P.FunctionDecl):
                self.functions.setdefault(item.name, []).append(item)
            elif isinstance(item, P.ConstDecl):
                self.consts[item.name] = item
            elif isinstance(item, (P.TypeDecl, P.EnumDecl)):
                self.types[item.name] = item
            if getattr(item, "exported", False):
                self.exported.add(item.name)


class ModuleScope:
    """Top-level name resolution for one module (own declarations, then std exports)."""

    def __init__(self, interp, module):
        self.interp = interp
        self.module = module
        self.cache = {}

    def lookup(self, name):
        cache = self.cache
        if name in cache:
            return cache[name]
        value = self.interp.resolve_global(name, self.module)
        cache[name] = value
        return value


class Library:
    """The parsed Onshape standard library (all modules), with a cache on disk."""

    def __init__(self, std_dir):
        self.std_dir = std_dir
        self.modules = {}
        files = sorted(glob.glob(os.path.join(std_dir, "*.fs")))
        digest = hashlib.sha1()
        for f in files:
            digest.update(f.encode())
            digest.update(str(os.path.getmtime(f)).encode())
        digest.update(open(P.__file__, "rb").read())
        cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "fs_sim")
        cache = os.path.join(cache_dir, f"std-{digest.hexdigest()[:16]}.pickle")
        asts = None
        if os.path.exists(cache):
            try:
                with open(cache, "rb") as handle:
                    asts = pickle.load(handle)
            except Exception:
                asts = None
        if asts is None:
            asts = {}
            for f in files:
                name = os.path.basename(f)
                with open(f, encoding="utf8") as handle:
                    asts[name] = P.parse(handle.read(), name)
            try:
                os.makedirs(cache_dir, exist_ok=True)
                with open(cache, "wb") as handle:
                    pickle.dump(asts, handle, protocol=pickle.HIGHEST_PROTOCOL)
            except Exception:
                pass
        for name, ast in asts.items():
            self.modules[name] = ModuleInfo(name, ast)

        # Every exported declaration in the library (visible to std code).
        self.all_functions, self.all_consts, self.all_types = {}, {}, {}
        for module in self.modules.values():
            for fname, decls in module.functions.items():
                if fname in module.exported:
                    self.all_functions.setdefault(fname, []).extend((d, module) for d in decls)
            for cname, decl in module.consts.items():
                if cname in module.exported:
                    self.all_consts.setdefault(cname, (decl, module))
            for tname, decl in module.types.items():
                if tname in module.exported:
                    self.all_types.setdefault(tname, (decl, module))

        # What `import(path : "onshape/std/geometry.fs")` makes visible to user code.
        self.user_visible = set()
        seen = set()

        def collect(module_name):
            if module_name in seen or module_name not in self.modules:
                return
            seen.add(module_name)
            module = self.modules[module_name]
            self.user_visible |= module.exported
            for imp in module.ast.imports:
                if imp.exported and imp.path:
                    collect(os.path.basename(imp.path))
        collect("geometry.fs")


class Interp:
    def __init__(self, library, natives):
        self.lib = library
        self.natives = natives  # name -> python callable(interp, args, node)
        self.closure_cache = {}
        self.enum_cache = {}
        self.op_cache = {}
        self.call_depth = 0
        self.user_module = None
        self.reports = []
        for module in library.modules.values():
            module.scope = ModuleScope(self, module)

    # ── module loading ──
    def load_user_module(self, code, name="feature.fs"):
        ast = P.parse(code, name)
        module = ModuleInfo(name, ast)
        module.scope = ModuleScope(self, module)
        module.is_user = True
        self.user_module = module
        return module

    def make_closure(self, decl, module):
        key = id(decl)
        closure = self.closure_cache.get(key)
        if closure is None:
            closure = Closure(decl.params, decl.body, module.scope, decl.precondition, decl.returns, decl.name, False, module, decl.kind)
            self.closure_cache[key] = closure
        return closure

    overrides = {}

    def resolve_global(self, name, module):
        if name in self.overrides:
            return self.overrides[name]
        lib = self.lib
        user = getattr(module, "is_user", False)
        # Functions: merge overloads from this module and every visible std module.
        decls = [(d, module) for d in module.functions.get(name, [])]
        if not user or name in lib.user_visible:
            decls += [entry for entry in lib.all_functions.get(name, []) if entry[1] is not module]
        if decls:
            closures = [self.make_closure(d, m) for d, m in decls]
            return closures[0] if len(closures) == 1 else OverloadSet(name, closures)
        if name in module.consts:
            return self.const_value(module.consts[name], module)
        if name in module.types:
            return self.type_value(module.types[name], module)
        if user and name not in lib.user_visible:
            raise KeyError(name)
        if name in lib.all_consts:
            decl, owner = lib.all_consts[name]
            return self.const_value(decl, owner)
        if name in lib.all_types:
            decl, owner = lib.all_types[name]
            return self.type_value(decl, owner)
        raise KeyError(name)

    def const_value(self, decl, module):
        prev_source = self.current_source
        self.current_source = module.name
        try:
            return self._const_value(decl, module)
        finally:
            self.current_source = prev_source

    def _const_value(self, decl, module):
        cache = module.const_values
        if decl.name in cache:
            value = cache[decl.name]
            if value is _EVALUATING:
                raise FSError(f"Circular definition of constant {decl.name}", line=decl.line, source=module.name)
            return value
        cache[decl.name] = _EVALUATING
        try:
            value = self.eval(decl.expr, module.scope)
            if decl.type and not self.is_type(value, decl.type):
                raise FSError(f"Constant {decl.name} is not a {decl.type}", line=decl.line, source=module.name)
        except BaseException:
            del cache[decl.name]
            raise
        cache[decl.name] = value
        return value

    def type_value(self, decl, module):
        if isinstance(decl, P.EnumDecl):
            enum = self.enum_cache.get(decl.name)
            if enum is None:
                enum = EnumType(decl.name, decl.values)
                self.enum_cache[decl.name] = enum
            return enum
        return TypeRef(decl.name, decl.predicate, module)

    def find_type(self, name):
        current = self.lib.modules.get(self.current_source)
        if current is not None and name in current.types:
            return current.types[name], current
        module = self.user_module
        if module is not None and name in module.types:
            return module.types[name], module
        found = self.lib.all_types.get(name)
        if found:
            return found
        for other in self.lib.modules.values():  # module-private types (e.g. error.fs StatusType)
            if name in other.types:
                return other.types[name], other
        return None, None

    # ── types ──
    def is_type(self, value, type_name):
        if type_name in BASE_TYPES:
            base = untag(value)
            if type_name == "number":
                return is_number(base)
            if type_name == "string":
                return isinstance(base, str)
            if type_name == "boolean":
                return isinstance(base, bool)
            if type_name == "array":
                return isinstance(base, tuple)
            if type_name == "map":
                return isinstance(base, FSMap)
            if type_name == "function":
                return isinstance(base, (Closure, Native, OverloadSet))
            if type_name == "box":
                return isinstance(base, Box)
            if type_name == "undefined":
                return value is None
            if type_name == "builtin":
                return isinstance(base, Builtin)
        if isinstance(value, Tagged):
            return value.tag == type_name
        if isinstance(value, EnumValue):
            return value.enum == type_name
        if isinstance(value, Builtin):
            return getattr(value, "fs_type", None) == type_name
        return False

    def cast(self, value, type_name, node):
        if type_name in BASE_TYPES:
            base = untag(value)
            if not self.is_type(base, type_name):
                raise self.error(f"Cannot convert {describe(value)} to {type_name}", node)
            return base
        decl, module = self.find_type(type_name)
        if decl is None:
            raise self.error(f"Unknown type {type_name}", node)
        if isinstance(decl, P.EnumDecl):
            return value
        base = untag(value)
        if isinstance(base, Builtin):
            return base
        predicate = self.resolve_in(decl.predicate, module)
        if not self.call(predicate, [base], node):
            raise self.error(f"Cannot convert value to {type_name}: typecheck {decl.predicate} failed for {fs_str(value)[:200]}", node)
        return Tagged(base, type_name)

    def resolve_in(self, name, module):
        try:
            return module.scope.lookup(name)
        except KeyError:
            raise FSError(f"Cannot resolve {name}")

    # ── errors ──
    def error(self, message, node=None, value=None):
        line = getattr(node, "line", None)
        return FSError(message, value=value, line=line, source=self.current_source)

    current_source = None

    # ── calls ──
    def call(self, fn, args, node=None):
        if isinstance(fn, Closure):
            return self.call_closure(fn, args, node)
        if isinstance(fn, OverloadSet):
            return self.call_closure(self.pick_overload(fn, args, node), args, node)
        if isinstance(fn, Native):
            return fn.fn(self, args, node)
        if isinstance(fn, EnumType) or isinstance(fn, TypeRef):
            raise self.error(f"{fn} is not a function", node)
        raise self.error(f"Cannot call {describe(fn)} (not a function)", node)

    def params_match(self, closure, args):
        params = closure.params
        if len(params) != len(args):
            return False
        for param, arg in zip(params, args):
            if param.type and not self.is_type(arg, param.type):
                return False
        return True

    def pick_overload(self, overloads, args, node):
        best, best_score = None, -1
        for closure in overloads.closures:
            if self.params_match(closure, args):
                score = sum(1 for p in closure.params if p.type and p.type not in ("map", "array"))
                score = score * 2 + sum(1 for p in closure.params if p.type)
                if score > best_score:
                    best, best_score = closure, score
        if best is None:
            raise self.error(f"No overload of {overloads.name} accepts ({', '.join(describe(a) for a in args)})", node)
        return best

    def call_closure(self, closure, args, node):
        params = closure.params
        if len(params) != len(args):
            raise self.error(f"{closure.name} expects {len(params)} argument(s), got {len(args)}", node)
        env = Env(closure.env)
        for param, arg in zip(params, args):
            if param.type and not self.is_type(arg, param.type):
                raise self.error(f"Argument {param.name} of {closure.name} must be {param.type}, got {describe(arg)}", node)
            env.vars[param.name] = arg
        self.call_depth += 1
        if self.call_depth > 4000:
            self.call_depth = 0
            raise self.error("Maximum call depth exceeded (infinite recursion?)", node)
        prev_source = self.current_source
        if closure.source is not None:
            self.current_source = closure.source
        try:
            if closure.precondition is not None:
                ok, failed = self.check_conditions(closure.precondition, env)
                if not ok:
                    raise self.error(f"Precondition of {closure.name} failed: {failed}", node)
            if closure.kind == "predicate":
                ok, _ = self.check_conditions(closure.body, env)
                return ok
            if closure.is_expr:
                result = self.eval(closure.body, env)
            else:
                signal = self.exec_block(closure.body.stmts, env)
                result = signal.value if signal is not None and signal.kind == "return" else None
            if closure.returns and not self.is_type(result, closure.returns):
                raise self.error(f"{closure.name} returned {describe(result)}, expected {closure.returns}", node)
            return result
        finally:
            self.current_source = prev_source
            self.call_depth -= 1

    def check_conditions(self, block, env):
        """Run precondition/predicate statements; every expression statement must be true."""
        stmts = block.stmts if isinstance(block, P.Block) else [block]
        signal = self.exec_block(stmts, env, True)
        if signal is None:
            return True, None
        if signal.kind == "fail":
            return False, signal.value
        if signal.kind == "return":
            return (signal.value is not False), "returned false"
        return True, None

    # ── statements ──
    def exec_block(self, stmts, env, check=False):
        for stmt in stmts:
            signal = self.exec_stmt(stmt, env, check)
            if signal is not None:
                return signal
        return None

    def exec_stmt(self, stmt, env, check=False):
        t = type(stmt)
        if t is P.ExprStmt:
            value = self.eval(stmt.expr, env)
            if check and type(stmt.expr) is not P.Assign:
                if value is True:
                    return None
                if value is False:
                    return Signal("fail", describe_node(stmt.expr))
                raise self.error(f"Condition is not a boolean ({describe(value)})", stmt)
            return None
        if t is P.VarDecl:
            for name, type_, expr in stmt.decls:
                value = self.eval(expr, env) if expr is not None else None
                if type_ and expr is not None and not self.is_type(value, type_):
                    raise self.error(f"Variable {name} must be {type_}, got {describe(value)}", stmt)
                env.vars[name] = value
            return None
        if t is P.Return:
            return Signal("return", self.eval(stmt.expr, env) if stmt.expr is not None else None)
        if t is P.If:
            cond = self.eval(stmt.cond, env)
            if cond is True:
                return self.exec_stmt(stmt.then, Env(env), check)
            if cond is False:
                return self.exec_stmt(stmt.orelse, Env(env), check) if stmt.orelse else None
            raise self.error(f"if condition must be a boolean, got {describe(cond)}", stmt)
        if t is P.Block:
            return self.exec_block(stmt.stmts, Env(env), check)
        if t is P.ForC:
            loop_env = Env(env)
            if stmt.init is not None:
                self.exec_stmt(stmt.init, loop_env)
            guard = 0
            while True:
                if stmt.cond is not None:
                    cond = self.eval(stmt.cond, loop_env)
                    if cond is False:
                        break
                    if cond is not True:
                        raise self.error(f"for-loop condition must be a boolean, got {describe(cond)}", stmt)
                signal = self.exec_stmt(stmt.body, Env(loop_env), check)
                if signal is not None:
                    if signal.kind == "break":
                        break
                    if signal.kind in ("return", "fail"):
                        return signal
                if stmt.step is not None:
                    self.eval(stmt.step, loop_env)
                guard += 1
                if guard > 2_000_000:
                    raise self.error("Loop ran more than 2,000,000 iterations", stmt)
            return None
        if t is P.ForIn:
            iterable = self.eval(stmt.iterable, env)
            for key, value in self.iterate(iterable, stmt, not stmt.key):
                inner = Env(env)
                if stmt.key:
                    inner.vars[stmt.key] = key
                inner.vars[stmt.value] = value
                signal = self.exec_stmt(stmt.body, inner, check)
                if signal is not None:
                    if signal.kind == "break":
                        break
                    if signal.kind in ("return", "fail"):
                        return signal
            return None
        if t is P.While:
            guard = 0
            while True:
                cond = self.eval(stmt.cond, env)
                if cond is False:
                    break
                if cond is not True:
                    raise self.error(f"while condition must be a boolean, got {describe(cond)}", stmt)
                signal = self.exec_stmt(stmt.body, Env(env), check)
                if signal is not None:
                    if signal.kind == "break":
                        break
                    if signal.kind in ("return", "fail"):
                        return signal
                guard += 1
                if guard > 2_000_000:
                    raise self.error("Loop ran more than 2,000,000 iterations", stmt)
            return None
        if t is P.Break:
            return BREAK
        if t is P.Continue:
            return CONTINUE
        if t is P.Throw:
            value = self.eval(stmt.expr, env)
            raise self.error(error_message(value), stmt, value=value)
        if t is P.Try:
            try:
                return self.exec_block(stmt.body.stmts, Env(env), check)
            except FSError as err:
                if stmt.catch_body is None:
                    return None
                inner = Env(env)
                if stmt.catch_name:
                    inner.vars[stmt.catch_name] = err.value if err.value is not None else err.message
                return self.exec_block(stmt.catch_body.stmts, inner)
        if t is P.Annotated:
            return self.exec_stmt(stmt.stmt, env, check)
        raise self.error(f"Unsupported statement {t.__name__}", stmt)

    def iterate(self, iterable, node, single=False):
        """(key, value) pairs; one loop variable over a map yields {key, value} entries."""
        base = untag(iterable)
        if isinstance(base, tuple):
            return list(enumerate(base))
        if isinstance(base, FSMap):
            if single:
                return [(k, FSMap({"key": k, "value": v})) for k, v in base.d.items()]
            return list(base.d.items())
        if base is None:
            raise self.error("Cannot iterate over undefined", node)
        raise self.error(f"Cannot iterate over {describe(iterable)}", node)

    # ── expressions ──
    def eval(self, expr, env):
        method = _EVAL[type(expr)]
        return method(self, expr, env)

    def ev_num(self, e, env):
        return e.value

    def ev_str(self, e, env):
        return e.value

    def ev_bool(self, e, env):
        return e.value

    def ev_undef(self, e, env):
        return None

    def ev_name(self, e, env):
        try:
            return env.lookup(e.name)
        except KeyError:
            raise self.error(f"Cannot resolve identifier {e.name}", e)

    def ev_array(self, e, env):
        return tuple(self.eval(item, env) for item in e.items)

    def ev_map(self, e, env):
        d = {}
        for key_expr, value_expr in e.entries:
            d[self.eval(key_expr, env)] = self.eval(value_expr, env)
        return FSMap(d)

    def ev_lambda(self, e, env):
        closure = Closure(e.params, e.body, env, e.precondition, e.returns, "<lambda>", e.is_expr, None)
        closure.source = self.current_source
        return closure

    def ev_call(self, e, env):
        fn = self.eval(e.func, env)
        args = [self.eval(a, env) for a in e.args]
        return self.call(fn, args, e)

    def ev_pipe(self, e, env):
        target = self.eval(e.target, env)
        fn = self.eval(e.func, env)
        args = [target] + [self.eval(a, env) for a in e.args]
        return self.call(fn, args, e)

    def ev_builtin(self, e, env):
        native = self.natives.get(e.name)
        args = [self.eval(a, env) for a in e.args]
        if native is None:
            raise SimulatorGap(f"native @{e.name} not implemented (called from {self.current_source}:{e.line})")
        return native(self, args, e)

    def ev_member(self, e, env):
        obj = self.eval(e.obj, env)
        return self.get_member(obj, e.name, e, e.optional)

    def get_member(self, obj, name, node, optional=False):
        if isinstance(obj, EnumType):
            if name in obj.values:
                return EnumValue(obj.name, name)
            raise self.error(f"{obj.name} has no value {name}", node)
        base = untag(obj)
        if isinstance(base, FSMap):
            return base.d.get(name)
        if base is None:
            if optional:
                return None
            raise self.error(f"Cannot read field '{name}' of undefined", node)
        if isinstance(base, Builtin) and hasattr(base, "fs_member"):
            return base.fs_member(name)
        raise self.error(f"Cannot read field '{name}' of {describe(obj)}", node)

    def ev_index(self, e, env):
        obj = self.eval(e.obj, env)
        index = self.eval(e.index, env)
        return self.get_index(obj, index, e)

    def get_index(self, obj, index, node):
        base = untag(obj)
        if isinstance(base, tuple):
            if not is_number(index) or not float(index).is_integer():
                raise self.error(f"Array index must be an integer, got {describe(index)}", node)
            i = int(index)
            if i < 0 or i >= len(base):
                raise self.error(f"Array index {i} out of range (size {len(base)})", node)
            return base[i]
        if isinstance(base, FSMap):
            return base.d.get(index)
        if base is None:
            raise self.error("Cannot index undefined", node)
        raise self.error(f"Cannot index {describe(obj)}", node)

    def ev_boxderef(self, e, env):
        obj = self.eval(e.obj, env)
        if not isinstance(obj, Box):
            raise self.error(f"[] dereference of non-box {describe(obj)}", e)
        return obj.value

    def ev_newbox(self, e, env):
        return Box(self.eval(e.expr, env))

    def ev_unary(self, e, env):
        value = self.eval(e.expr, env)
        if e.op == "!":
            if not isinstance(value, bool):
                raise self.error(f"! needs a boolean, got {describe(value)}", e)
            return not value
        if is_number(value):
            return -value
        return self.call_operator("-", [value], e)

    def ev_binary(self, e, env):
        left = self.eval(e.left, env)
        right = self.eval(e.right, env)
        return self.binary(e.op, left, right, e)

    def binary(self, op, left, right, node):
        if op == "==":
            return fs_equal(left, right)
        if op == "!=":
            return not fs_equal(left, right)
        if op == "~":
            return fs_str(left) + fs_str(right)
        if is_number(left) and is_number(right):
            try:
                if op == "+":
                    return left + right
                if op == "-":
                    return left - right
                if op == "*":
                    return left * right
                if op == "/":
                    if right == 0:
                        raise self.error("Division by zero", node)
                    return left / right
                if op == "%":
                    if right == 0:
                        raise self.error("Modulo by zero", node)
                    return math.fmod(left, right)
                if op == "^":
                    return float(left) ** right
                if op == "<":
                    return left < right
                if op == ">":
                    return left > right
                if op == "<=":
                    return left <= right
                if op == ">=":
                    return left >= right
            except (OverflowError, ValueError, ZeroDivisionError) as err:
                raise self.error(f"Arithmetic error: {err}", node)
        if isinstance(left, str) and isinstance(right, str) and op in ("<", ">", "<=", ">="):
            return {"<": left < right, ">": left > right, "<=": left <= right, ">=": left >= right}[op]
        if op in (">", ">="):
            # a > b is b < a; a >= b is !(a < b)
            if op == ">":
                return self.call_operator("<", [right, left], node)
            return not self.call_operator("<", [left, right], node)
        if op == "<=":
            return not self.call_operator("<", [right, left], node)
        return self.call_operator(op, [left, right], node)

    def call_operator(self, op, args, node):
        name = "operator" + op
        fn = self.op_cache.get(name)
        if fn is None:
            try:
                fn = self.lib.modules["units.fs"].scope.lookup(name)
            except KeyError:
                fn = None
            self.op_cache[name] = fn
        if fn is None:
            raise self.error(f"No operator {op} for {', '.join(describe(a) for a in args)}", node)
        candidates = fn.closures if isinstance(fn, OverloadSet) else [fn]
        matches = [c for c in candidates if self.params_match(c, args)]
        if not matches:
            raise self.error(f"Operator {op} is not defined for {' and '.join(describe(a) for a in args)}", node)
        best = max(matches, key=lambda c: sum(1 for p in c.params if p.type))
        return self.call_closure(best, args, node)

    def ev_logical(self, e, env):
        left = self.eval(e.left, env)
        if e.op == "??":
            return left if left is not None else self.eval(e.right, env)
        if not isinstance(left, bool):
            raise self.error(f"{e.op} needs booleans, got {describe(left)}", e)
        if e.op == "&&":
            if not left:
                return False
        elif left:
            return True
        right = self.eval(e.right, env)
        if not isinstance(right, bool):
            raise self.error(f"{e.op} needs booleans, got {describe(right)}", e)
        return right

    def ev_ternary(self, e, env):
        cond = self.eval(e.cond, env)
        if cond is True:
            return self.eval(e.then, env)
        if cond is False:
            return self.eval(e.orelse, env)
        raise self.error(f"?: condition must be a boolean, got {describe(cond)}", e)

    def ev_is(self, e, env):
        value = self.eval(e.expr, env)
        if e.type not in BASE_TYPES:
            decl, _ = self.find_type(e.type)
            if decl is None and e.type not in ("Context", "Sketch"):
                raise self.error(f"Unknown type {e.type}", e)
            if isinstance(decl, P.TypeDecl) and decl.predicate in ("canBeContext", "canBeSketch"):
                return isinstance(value, Builtin) and getattr(value, "fs_type", None) == e.type
        return self.is_type(value, e.type)

    def ev_as(self, e, env):
        return self.cast(self.eval(e.expr, env), e.type, e)

    def ev_tryexpr(self, e, env):
        try:
            return self.eval(e.expr, env)
        except FSError:
            return None

    def ev_switch(self, e, env):
        subject = self.eval(e.expr, env)
        for key_expr, value_expr in e.cases:
            if fs_equal(self.eval(key_expr, env), subject):
                return self.eval(value_expr, env)
        raise self.error(f"switch has no case for {fs_str(subject)}", e)

    def ev_assign(self, e, env):
        value = self.eval(e.expr, env)
        if e.op != "=":
            current = self.eval(e.target, env)
            value = self.binary(e.op[0], current, value, e)
        self.assign(e.target, value, env, e)
        return value

    def assign(self, target, value, env, node):
        t = type(target)
        if t is P.Name:
            try:
                env.assign(target.name, value)
            except KeyError:
                raise self.error(f"Cannot assign to undeclared variable {target.name}", node)
            return
        if t is P.BoxDeref:
            box = self.eval(target.obj, env)
            if not isinstance(box, Box):
                raise self.error(f"[] assignment to non-box {describe(box)}", node)
            box.value = value
            return
        if t is P.Member:
            container = self.eval(target.obj, env)
            self.assign(target.obj, self.set_key(container, target.name, value, node), env, node)
            return
        if t is P.Index:
            container = self.eval(target.obj, env)
            key = self.eval(target.index, env)
            self.assign(target.obj, self.set_key(container, key, value, node, index=True), env, node)
            return
        raise self.error("Invalid assignment target", node)

    def set_key(self, container, key, value, node, index=False):
        if isinstance(container, Tagged):
            return Tagged(self.set_key(container.v, key, value, node, index), container.tag)
        if isinstance(container, FSMap):
            return container.set(key, value)
        if isinstance(container, tuple) and index:
            if not is_number(key) or not float(key).is_integer() or not (0 <= int(key) < len(container)):
                raise self.error(f"Array index {fs_str(key)} out of range (size {len(container)})", node)
            items = list(container)
            items[int(key)] = value
            return tuple(items)
        if container is None:
            raise self.error(f"Cannot set field {fs_str(key)} of undefined", node)
        raise self.error(f"Cannot set field {fs_str(key)} of {describe(container)}", node)


class _Evaluating:
    pass


_EVALUATING = _Evaluating()


class EnumType:
    def __init__(self, name, values):
        self.name = name
        self.values = set(values)
        self.ordered = list(values)

    def __repr__(self):
        return f"<enum {self.name}>"


class TypeRef:
    def __init__(self, name, predicate, module):
        self.name, self.predicate, self.module = name, predicate, module

    def __repr__(self):
        return f"<type {self.name}>"


def fs_equal(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if is_number(a) and is_number(b):
        return a == b
    if type(a) is not type(b):
        return False
    if isinstance(a, Tagged):
        return a.tag == b.tag and fs_equal(a.v, b.v)
    if isinstance(a, tuple):
        return len(a) == len(b) and all(fs_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, FSMap):
        if len(a.d) != len(b.d):
            return False
        for key, value in a.d.items():
            if key not in b.d or not fs_equal(value, b.d[key]):
                return False
        return True
    if isinstance(a, (Box, Builtin, Closure)):
        return a is b
    return a == b


def describe(value):
    if isinstance(value, Tagged):
        return value.tag
    if value is None:
        return "undefined"
    if isinstance(value, bool):
        return "boolean"
    if is_number(value):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, tuple):
        return "array"
    if isinstance(value, FSMap):
        return "map"
    if isinstance(value, EnumValue):
        return value.enum
    if isinstance(value, (Closure, Native, OverloadSet)):
        return "function"
    if isinstance(value, Builtin):
        return getattr(value, "fs_type", "builtin")
    return type(value).__name__


def describe_node(node, depth=0):
    """Approximate source text of an expression, for precondition messages."""
    if depth > 6:
        return "..."
    d = lambda n: describe_node(n, depth + 1)
    if isinstance(node, P.Name):
        return node.name
    if isinstance(node, P.Num):
        return fs_str(node.value)
    if isinstance(node, P.Str):
        return f'"{node.value}"'
    if isinstance(node, P.Bool):
        return "true" if node.value else "false"
    if isinstance(node, P.Undef):
        return "undefined"
    if isinstance(node, P.Member):
        return f"{d(node.obj)}.{node.name}"
    if isinstance(node, P.Index):
        return f"{d(node.obj)}[{d(node.index)}]"
    if isinstance(node, P.Call):
        return f"{d(node.func)}({', '.join(d(a) for a in node.args)})"
    if isinstance(node, P.Builtin):
        return f"@{node.name}({', '.join(d(a) for a in node.args)})"
    if isinstance(node, P.IsType):
        return f"{d(node.expr)} is {node.type}"
    if isinstance(node, (P.Binary, P.Logical)):
        return f"{d(node.left)} {node.op} {d(node.right)}"
    if isinstance(node, P.Unary):
        return f"{node.op}{d(node.expr)}"
    return type(node).__name__


def error_message(value):
    base = untag(value)
    if isinstance(base, FSMap):
        custom = base.d.get("customMessage")
        message = base.d.get("message")
        if custom:
            return str(custom)
        if message is not None:
            return fs_str(message)
    return fs_str(value)


_EVAL = {
    P.Num: Interp.ev_num, P.Str: Interp.ev_str, P.Bool: Interp.ev_bool, P.Undef: Interp.ev_undef,
    P.Name: Interp.ev_name, P.ArrayLit: Interp.ev_array, P.MapLit: Interp.ev_map, P.Lambda: Interp.ev_lambda,
    P.Call: Interp.ev_call, P.PipeCall: Interp.ev_pipe, P.Builtin: Interp.ev_builtin, P.Member: Interp.ev_member,
    P.Index: Interp.ev_index, P.BoxDeref: Interp.ev_boxderef, P.NewBox: Interp.ev_newbox, P.Unary: Interp.ev_unary,
    P.Binary: Interp.ev_binary, P.Logical: Interp.ev_logical, P.Ternary: Interp.ev_ternary, P.IsType: Interp.ev_is,
    P.AsType: Interp.ev_as, P.Assign: Interp.ev_assign, P.TryExpr: Interp.ev_tryexpr, P.Switch: Interp.ev_switch,
}

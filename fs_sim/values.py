"""FeatureScript runtime values.

FeatureScript has value semantics for arrays and maps, so arrays are Python tuples
and maps are immutable FSMap objects; "mutation" rebuilds containers and rebinds
the variable. A type tag (from `as T`) wraps a value in Tagged.
"""
import math


class FSMap:
    __slots__ = ("d", "_hash")

    def __init__(self, d=None):
        self.d = d if d is not None else {}
        self._hash = None

    def get(self, key, default=None):
        return self.d.get(key, default)

    def set(self, key, value):
        d = dict(self.d)
        if value is None:
            d.pop(key, None)  # assigning undefined removes the entry
        else:
            d[key] = value
        return FSMap(d)

    def __eq__(self, other):
        return isinstance(other, FSMap) and self.d == other.d

    def __hash__(self):
        if self._hash is None:
            self._hash = hash(frozenset(self.d.items()))
        return self._hash

    def __repr__(self):
        return "{" + ", ".join(f"{k!r}: {v!r}" for k, v in self.d.items()) + "}"


class Tagged:
    __slots__ = ("v", "tag")

    def __init__(self, v, tag):
        self.v, self.tag = v, tag

    def __eq__(self, other):
        return isinstance(other, Tagged) and self.tag == other.tag and self.v == other.v

    def __hash__(self):
        return hash((self.tag, self.v))

    def __repr__(self):
        return f"{self.v!r} as {self.tag}"


class EnumValue:
    __slots__ = ("enum", "name")

    def __init__(self, enum, name):
        self.enum, self.name = enum, name

    def __eq__(self, other):
        return isinstance(other, EnumValue) and self.enum == other.enum and self.name == other.name

    def __hash__(self):
        return hash((self.enum, self.name))

    def __repr__(self):
        return f"{self.enum}.{self.name}"


class Box:
    __slots__ = ("value",)

    def __init__(self, value):
        self.value = value

    def __repr__(self):
        return f"box({self.value!r})"


class Builtin:
    """Opaque native object (Context, Sketch, ...)."""
    kind = "builtin"


def untag(v):
    return v.v if isinstance(v, Tagged) else v


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def fs_str(v):
    """String conversion used by `~` and toString."""
    if isinstance(v, Tagged):
        if v.tag == "ValueWithUnits" and isinstance(v.v, FSMap):
            return fs_str(v.v.get("value")) + " " + fs_str(v.v.get("unit"))
        return fs_str(v.v)
    if v is None:
        return "undefined"
    if isinstance(v, bool):
        return "true" if v else "false"
    if is_number(v):
        if math.isfinite(v) and float(v).is_integer() and abs(v) < 1e15:
            return str(int(v))
        return repr(float(v)) if math.isfinite(v) else ("inf" if v > 0 else "-inf") if not math.isnan(v) else "nan"
    if isinstance(v, str):
        return v
    if isinstance(v, EnumValue):
        return v.name
    if isinstance(v, tuple):
        return "[ " + ", ".join(fs_str(x) for x in v) + " ]"
    if isinstance(v, FSMap):
        return "{ " + ", ".join(f"{fs_str(k)} : {fs_str(x)}" for k, x in v.d.items()) + " }"
    return f"<{type(v).__name__}>"

"""Non-geometric FeatureScript natives: math, containers, strings, regex, matrices."""
import math
import re

from .values import FSMap, Tagged, fs_str, is_number, untag


def _num(interp, value, node, name):
    value = untag(value)
    if not is_number(value):
        raise interp.error(f"@{name} expects a number, got {type(value).__name__}", node)
    return value


def _arr(interp, value, node, name):
    value = untag(value)
    if not isinstance(value, tuple):
        raise interp.error(f"@{name} expects an array", node)
    return value


def _str(interp, value, node, name):
    value = untag(value)
    if not isinstance(value, str):
        raise interp.error(f"@{name} expects a string", node)
    return value


def unary_math(fn, name):
    def native(interp, args, node):
        x = _num(interp, args[0], node, name)
        try:
            return float(fn(x))
        except (ValueError, OverflowError):
            return float("nan")
    return native


def _java_regex(pattern):
    # FeatureScript regexes are Java-style; Python's re is close enough for std usage.
    return pattern.replace("(?<", "(?P<") if "(?<" in pattern and "(?<=" not in pattern and "(?<!" not in pattern else pattern


def n_size(interp, args, node):
    value = untag(args[0])
    if isinstance(value, tuple):
        return len(value)
    if isinstance(value, FSMap):
        return len(value.d)
    if isinstance(value, str):
        return len(value)
    raise interp.error("@size expects an array or map", node)


def n_resize(interp, args, node):
    arr = _arr(interp, args[0], node, "resize")
    n = int(_num(interp, args[1], node, "resize"))
    if n < 0:
        raise interp.error("@resize to a negative size", node)
    fill = args[2] if len(args) > 2 else None
    return tuple(arr[:n]) + (fill,) * max(0, n - len(arr))


def n_sub_array(interp, args, node):
    arr = _arr(interp, args[0], node, "subArray")
    start = int(_num(interp, args[1], node, "subArray"))
    end = int(_num(interp, args[2], node, "subArray")) if len(args) > 2 else len(arr)
    if start < 0 or end > len(arr) or start > end:
        raise interp.error(f"@subArray range [{start}, {end}) invalid for size {len(arr)}", node)
    return tuple(arr[start:end])


def n_concat(interp, args, node):
    out = []
    for part in _arr(interp, args[0], node, "concatenateArrays"):
        out.extend(_arr(interp, part, node, "concatenateArrays"))
    return tuple(out)


def n_index_of(interp, args, node):
    from .interp import fs_equal
    arr = _arr(interp, args[0], node, "indexOf")
    start = int(args[2]) if len(args) > 2 else 0
    for i in range(start, len(arr)):
        if fs_equal(arr[i], args[1]):
            return i
    return -1


def n_keys(interp, args, node):
    m = untag(args[0])
    if not isinstance(m, FSMap):
        raise interp.error("@keys expects a map", node)
    return tuple(m.d.keys())


def n_values(interp, args, node):
    m = untag(args[0])
    if not isinstance(m, FSMap):
        raise interp.error("@values expects a map", node)
    return tuple(m.d.values())


def n_merge_maps(interp, args, node):
    def merge(a, b):
        base_a, base_b = untag(a), untag(b)
        if isinstance(base_a, FSMap) and isinstance(base_b, FSMap):
            d = dict(base_a.d)
            for key, value in base_b.d.items():
                d[key] = merge(d[key], value) if key in d else value
            merged = FSMap(d)
            return Tagged(merged, b.tag) if isinstance(b, Tagged) else Tagged(merged, a.tag) if isinstance(a, Tagged) else merged
        return b
    return merge(args[0], args[1])


def n_intersect_maps(interp, args, node):
    maps = [untag(m) for m in _arr(interp, args[0], node, "intersectMaps")]
    if not maps:
        return FSMap({})
    d = {k: v for k, v in maps[0].d.items() if all(k in m.d for m in maps[1:])}
    return FSMap(d)


def n_reverse(interp, args, node):
    return tuple(reversed(_arr(interp, args[0], node, "reverse")))


def n_range(interp, args, node):
    start = _num(interp, args[0], node, "range")
    end = _num(interp, args[1], node, "range")
    count = int(_num(interp, args[2], node, "range"))
    if count == 1:
        return (start,)
    return tuple(start + (end - start) * i / (count - 1) for i in range(count))


def n_replace(interp, args, node):
    s = _str(interp, args[0], node, "replace")
    pattern = _java_regex(_str(interp, args[1], node, "replace"))
    replacement = _str(interp, args[2], node, "replace")
    replacement = re.sub(r"\$(\d+)", r"\\\1", replacement)
    return re.sub(pattern, replacement, s)


def n_match(interp, args, node):
    s = _str(interp, args[0], node, "match")
    m = re.fullmatch(_java_regex(_str(interp, args[1], node, "match")), s)
    if not m:
        return FSMap({"hasMatch": False, "captures": ()})
    return FSMap({"hasMatch": True, "captures": (s,) + tuple(g if g is not None else "" for g in m.groups())})


def n_split_regexp(interp, args, node):
    return tuple(re.split(_java_regex(_str(interp, args[1], node, "splitByRegexp")), _str(interp, args[0], node, "splitByRegexp")))


def n_string_to_number(interp, args, node):
    s = _str(interp, args[0], node, "stringToNumber")
    try:
        return float(s)
    except ValueError:
        raise interp.error(f"Cannot convert '{s}' to a number", node)


def n_substring(interp, args, node):
    s = _str(interp, args[0], node, "substring")
    start = int(args[1])
    end = int(args[2]) if len(args) > 2 else len(s)
    return s[start:end]


def _rows(m):
    return [[float(untag(x)) for x in untag(row)] for row in untag(m)]


def _pack(rows):
    return tuple(tuple(float(x) for x in row) for row in rows)


def n_matrix_multiply(interp, args, node):
    a, b = untag(args[0]), untag(args[1])
    if is_number(b):
        return _pack([[x * b for x in row] for row in _rows(a)])
    if is_number(a):
        return _pack([[x * a for x in row] for row in _rows(b)])
    A = _rows(a)
    if b and not isinstance(untag(b[0]), tuple):  # matrix * vector
        v = [float(untag(x)) for x in b]
        return tuple(sum(row[k] * v[k] for k in range(len(v))) for row in A)
    B = _rows(b)
    if len(A[0]) != len(B):
        raise interp.error("Matrix dimension mismatch", node)
    return _pack([[sum(A[i][k] * B[k][j] for k in range(len(B))) for j in range(len(B[0]))] for i in range(len(A))])


def n_matrix_identity(interp, args, node):
    n = int(untag(args[0]))
    return _pack([[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)])


def n_matrix_transpose(interp, args, node):
    return _pack(list(map(list, zip(*_rows(args[0])))))


def n_matrix_inverse(interp, args, node):
    import numpy as np
    return _pack(np.linalg.inv(np.array(_rows(args[0]))).tolist())


def n_matrix_determinant(interp, args, node):
    import numpy as np
    return float(np.linalg.det(np.array(_rows(args[0]))))


def n_matrix_elementwise(op):
    def native(interp, args, node):
        return _pack([[op(x, y) for x, y in zip(ra, rb)] for ra, rb in zip(_rows(args[0]), _rows(args[1]))])
    return native


def n_matrix_negate(interp, args, node):
    return _pack([[-x for x in row] for row in _rows(args[0])])


def n_matrix_squared_norm(interp, args, node):
    return float(sum(x * x for row in _rows(args[0]) for x in row))


def n_is_matrix(interp, args, node):
    m = untag(args[0])
    if not isinstance(m, tuple) or not m:
        return False
    rows = [untag(r) for r in m]
    if not all(isinstance(r, tuple) and r for r in rows):
        return False
    width = len(rows[0])
    return all(len(r) == width and all(is_number(untag(x)) for x in r) for r in rows)


def n_matrix_rotation(interp, args, node):
    axis = [float(untag(x)) for x in untag(args[0])]
    angle = untag(args[1])
    if isinstance(angle, FSMap):
        angle = angle.d["value"]
    n = math.sqrt(sum(a * a for a in axis))
    x, y, z = (a / n for a in axis)
    c, s = math.cos(angle), math.sin(angle)
    t = 1 - c
    return _pack([[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
                  [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
                  [t * x * z - s * y, t * y * z + s * x, t * z * z + c]])


def n_normalize(interp, args, node):
    v = [untag(x) for x in untag(args[0])]
    n = math.sqrt(sum(x * x for x in v))
    if n == 0:
        raise interp.error("Cannot normalize a zero vector", node)
    return tuple(x / n for x in v)


def n_print(interp, args, node):
    interp.reports.append(fs_str(args[0]))
    return None


def n_report(interp, args, node):
    interp.reports.append(fs_str(args[0]) if args else "")
    return None


def n_tolerant_sort(interp, args, node):
    values = [untag(v) for v in _arr(interp, args[0], node, "tolerantSort")]
    return tuple(sorted(range(len(values)), key=lambda i: values[i]))


def n_internal_type(interp, args, node):
    from .interp import describe
    return describe(args[0])


NATIVES = {
    "size": n_size,
    "resize": n_resize,
    "subArray": n_sub_array,
    "concatenateArrays": n_concat,
    "indexOf": n_index_of,
    "keys": n_keys,
    "values": n_values,
    "mergeMaps": n_merge_maps,
    "intersectMaps": n_intersect_maps,
    "reverse": n_reverse,
    "range": n_range,
    "sqrt": unary_math(math.sqrt, "sqrt"),
    "sin": unary_math(math.sin, "sin"),
    "cos": unary_math(math.cos, "cos"),
    "tan": unary_math(math.tan, "tan"),
    "asin": unary_math(math.asin, "asin"),
    "acos": unary_math(math.acos, "acos"),
    "atan": unary_math(math.atan, "atan"),
    "sinh": unary_math(math.sinh, "sinh"),
    "cosh": unary_math(math.cosh, "cosh"),
    "tanh": unary_math(math.tanh, "tanh"),
    "asinh": unary_math(math.asinh, "asinh"),
    "acosh": unary_math(math.acosh, "acosh"),
    "atanh": unary_math(math.atanh, "atanh"),
    "exp": unary_math(math.exp, "exp"),
    "log": unary_math(math.log, "log"),
    "log10": unary_math(math.log10, "log10"),
    "floor": unary_math(math.floor, "floor"),
    "ceil": unary_math(math.ceil, "ceil"),
    "abs": unary_math(abs, "abs"),
    "atan2": lambda interp, args, node: math.atan2(untag(args[0]), untag(args[1])),
    "hypot": lambda interp, args, node: math.hypot(untag(args[0]), untag(args[1])),
    "replace": n_replace,
    "match": n_match,
    "splitByRegexp": n_split_regexp,
    "stringToNumber": n_string_to_number,
    "length": lambda interp, args, node: len(_str(interp, args[0], node, "length")),
    "substring": n_substring,
    "startsWith": lambda interp, args, node: _str(interp, args[0], node, "startsWith").startswith(_str(interp, args[1], node, "startsWith")),
    "endsWith": lambda interp, args, node: _str(interp, args[0], node, "endsWith").endswith(_str(interp, args[1], node, "endsWith")),
    "splitIntoCharacters": lambda interp, args, node: tuple(_str(interp, args[0], node, "splitIntoCharacters")),
    "indexOfString": lambda interp, args, node: _str(interp, args[0], node, "indexOfString").find(_str(interp, args[1], node, "indexOfString")),
    "indexOfRegexp": lambda interp, args, node: (lambda m: m.start() if m else -1)(re.search(_java_regex(args[1]), args[0])),
    "repeatString": lambda interp, args, node: _str(interp, args[0], node, "repeatString") * int(args[1]),
    "toString": lambda interp, args, node: fs_str(args[0]),
    "isAtVersionOrLater": lambda interp, args, node: True,
    "getLanguageVersion": lambda interp, args, node: 2960.0,
    "getCurrentVersion": lambda interp, args, node: 2960.0,
    "matrixMultiply": n_matrix_multiply,
    "matrixIdentity": n_matrix_identity,
    "matrixTranspose": n_matrix_transpose,
    "matrixInverse": n_matrix_inverse,
    "matrixDeterminant": n_matrix_determinant,
    "matrixSum": n_matrix_elementwise(lambda x, y: x + y),
    "matrixDifference": n_matrix_elementwise(lambda x, y: x - y),
    "matrixCwiseProduct": n_matrix_elementwise(lambda x, y: x * y),
    "matrixNegate": n_matrix_negate,
    "matrixSquaredNorm": n_matrix_squared_norm,
    "matrixRotation3d": n_matrix_rotation,
    "isMatrix": n_is_matrix,
    "normalize": n_normalize,
    "print": n_print,
    "report": n_report,
    "tolerantSort": n_tolerant_sort,
    "internalType": n_internal_type,
}

"""Builds an interpreter loaded with the Onshape std library and all natives."""
import os

from .interp import Interp, Library
from .natives import NATIVES

STD_DIR = os.environ.get("FS_STD_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "std")
_LIBRARY = None


def library():
    global _LIBRARY
    if _LIBRARY is None:
        if not os.path.exists(os.path.join(STD_DIR, "geometry.fs")):
            raise RuntimeError(f"Onshape std library not found at {STD_DIR}; run fs_sim/fetch_std.sh")
        _LIBRARY = Library(STD_DIR)
    return _LIBRARY


def new_interp():
    natives = dict(NATIVES)
    try:
        from .geom import GEOM_NATIVES
        natives.update(GEOM_NATIVES)
    except ImportError:
        pass
    interp = Interp(library(), natives)
    return interp


def eval_snippet(body, interp=None):
    """Runs `body` (statements ending in a return) inside a function in a user module."""
    interp = interp or new_interp()
    code = 'FeatureScript 2931;\nimport(path : "onshape/std/geometry.fs", version : "2931.0");\nexport function main()\n{\n' + body + "\n}\n"
    module = interp.load_user_module(code, "snippet.fs")
    fn = module.scope.lookup("main")
    return interp.call(fn, [], None)

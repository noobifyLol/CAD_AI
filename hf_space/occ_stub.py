"""Stand-in for pythonocc-core (the `OCC` package).

Text2CAD's CadSeqProc imports OCC at module level because it can also build B-rep
solids, meshes and STEP files. This service only decodes the model's token vector
into a sketch/extrude sequence (pure numpy), and pythonocc-core is conda-only, so
when the real package is missing every `OCC.*` import resolves to an inert stub.
Calling anything that really needs OpenCascade then fails loudly instead of at import.
"""
import importlib.abc
import importlib.machinery
import sys
import types


class _OCCStub:
    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        raise RuntimeError("OpenCascade (pythonocc-core) is not installed in this service.")

    def __getattr__(self, name):
        raise RuntimeError("OpenCascade (pythonocc-core) is not installed in this service.")


class _StubModule(types.ModuleType):
    __path__ = []  # behave like a package so `OCC.Core.gp` imports resolve

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _OCCStub


class _OCCFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, fullname, path, target=None):
        if fullname == "OCC" or fullname.startswith("OCC."):
            return importlib.machinery.ModuleSpec(fullname, self, is_package=True)
        return None

    def create_module(self, spec):
        return _StubModule(spec.name)

    def exec_module(self, module):
        pass


def install_if_missing():
    """Returns True when the stub was installed (real OCC unavailable)."""
    try:
        import OCC.Core.gp  # noqa: F401
        return False
    except ImportError:
        pass
    if not any(isinstance(finder, _OCCFinder) for finder in sys.meta_path):
        sys.meta_path.insert(0, _OCCFinder())
    return True

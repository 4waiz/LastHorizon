"""
LastHorizon — regenerate the entire asset kit.

From a terminal:

    blender --background --python scripts/blender/build_all.py

or, inside a running Blender (this is how the kit was originally authored,
driven over Blender MCP):

    exec(open("scripts/blender/build_all.py").read())

Writes seven GLBs into public/assets/models/. Everything is procedural, so the
kit is reproducible and no binary source assets need to live in the repo.
"""

import importlib
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else \
    "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender"
if HERE not in sys.path:
    sys.path.append(HERE)

import lh_common  # noqa: E402
importlib.reload(lh_common)

MODULES = [
    "build_character",
    "build_buildings",
    "build_props",
    "build_nature",
    "build_collectibles",
    "build_vehicles",
    "build_interior_kit",
]


def run_all():
    results = []
    for name in MODULES:
        ns = {"__name__": "lh_build_" + name}
        path = os.path.join(HERE, name + ".py")
        try:
            exec(compile(open(path, encoding="utf-8").read(), name + ".py", "exec"), ns)
            results.append(ns["RESULT"])
        except Exception:
            results.append({"file": name, "kb": 0.0, "error": traceback.format_exc()[-800:]})
    return results


RESULTS = run_all()
print(lh_common.report(RESULTS))

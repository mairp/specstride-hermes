# Pytest conftest of the glue tests (T040): the package under
# `hermes-plugin/specstride/` is imported as `specstride` from the
# repository, with no install step.
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ROOT = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(PLUGIN_ROOT)

if PLUGIN_ROOT not in sys.path:
    sys.path.insert(0, PLUGIN_ROOT)

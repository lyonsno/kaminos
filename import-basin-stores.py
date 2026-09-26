#!/usr/bin/env python3
"""Import existing volume settings stores into the shared basin library.

Usage: python3 import-basin-stores.py [--shared-basin-store PATH] [--stores-file FILE] [STORE ...]

Additive and idempotent: every artifact's content hash is verified before it is
accepted, nothing in the source stores is modified, and labels merge through
the library's append-only history. Prints the import receipt as JSON.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve  # noqa: E402


def main(argv):
    shared = serve.SHARED_BASIN_STORE_DEFAULT
    stores = []
    arguments = list(argv)
    while arguments:
        argument = arguments.pop(0)
        if argument == "--shared-basin-store" and arguments:
            shared = serve._volume_settings_store_path(arguments.pop(0))
        elif argument == "--stores-file" and arguments:
            stores.extend(line.strip() for line in Path(arguments.pop(0)).read_text().splitlines() if line.strip())
        elif argument.startswith("-"):
            print(__doc__, file=sys.stderr)
            return 2
        else:
            stores.append(argument)
    if shared is None:
        print("import-basin-stores: the shared basin library is disabled (KAMINOS_SHARED_BASIN_STORE)", file=sys.stderr)
        return 2
    if not stores:
        print(__doc__, file=sys.stderr)
        return 2
    report = serve.import_volume_settings_stores(shared, stores)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

"""Extract only ordinary files/directories beneath the expected release root."""
import pathlib
import sys
import tarfile

try:
    archive, expected = sys.argv[1:]
    if expected not in ("release-bundle", "cdk.out.prod"):
        raise ValueError()
    destination = pathlib.Path(expected)
    if destination.exists() or destination.is_symlink():
        raise ValueError()
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if sum(item.size for item in members) > 1024 * 1024 * 1024:
            raise ValueError()
        for item in members:
            path = pathlib.PurePosixPath(item.name)
            if (not path.parts or path.parts[0] != expected or ".." in path.parts
                    or not (item.isfile() or item.isdir())):
                raise ValueError()
        # Every entry is a bounded regular file/directory under a new destination.
        bundle.extractall()
except Exception:
    sys.exit("Unsafe or invalid release archive.")

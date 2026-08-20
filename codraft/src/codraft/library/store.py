"""Where a builder's range lives on disk.

One JSON file per design, in a directory. Not a database, because a
builder's catalogue is forty files that change twice a year, and a
directory can be put in version control, diffed and reviewed -- which
matters when the thing being changed is what the company sells.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .design import Design


@dataclass(slots=True)
class DesignLibrary:
    """A directory of designs."""

    path: Path
    designs: list[Design] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, path: str | Path) -> "DesignLibrary":
        path = Path(path)
        library = cls(path=path)
        if not path.exists():
            return library
        for file in sorted(path.glob("*.json")):
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                library.problems.append(f"{file.name}: {exc}")
                continue
            entries = data if isinstance(data, list) else [data]
            for entry in entries:
                try:
                    library.designs.append(Design.from_dict(entry))
                except (TypeError, ValueError) as exc:
                    library.problems.append(f"{file.name}: {exc}")
        return library

    def add(self, design: Design) -> Path:
        self.path.mkdir(parents=True, exist_ok=True)
        file = self.path / f"{design.id}.json"
        file.write_text(design.to_json() + "\n", encoding="utf-8")
        self.designs = [d for d in self.designs if d.id != design.id]
        self.designs.append(design)
        return file

    def get(self, design_id: str) -> Design | None:
        return next((d for d in self.designs if d.id == design_id), None)

    def matching(
        self, bedrooms: int | None = None, storeys: int | None = None
    ) -> list[Design]:
        """The designs worth trying, before any geometry is considered."""
        out = self.designs
        if bedrooms is not None:
            out = [d for d in out if d.bedrooms == bedrooms]
        if storeys is not None:
            out = [d for d in out if d.storeys == storeys]
        return out

    def __len__(self) -> int:
        return len(self.designs)

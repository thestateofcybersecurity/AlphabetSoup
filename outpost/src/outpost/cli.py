"""outpost migrate | seed | lint. Migrations and seeds are plain psql files, so this shells out to psql."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import psycopg

SQL = Path(__file__).resolve().parents[2] / "sql"


def _psql(dsn: str, path: Path, *vars_: str) -> None:
    cmd = ["psql", dsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", *sum((["-v", v] for v in vars_), []), "-f", str(path)]
    subprocess.run(cmd, check=True, env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"})


def _dbname(dsn: str) -> str:
    with psycopg.connect(dsn) as c:
        return c.execute("select current_database()").fetchone()[0]


def migrate(admin_dsn: str) -> list[str]:
    applied: list[str] = []
    with psycopg.connect(admin_dsn, autocommit=True) as c:
        c.execute("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())")
        done = {r[0] for r in c.execute("select name from public.schema_migrations")}
    for path in sorted(SQL.joinpath("migrations").glob("*.sql")):
        if path.name in done:
            continue
        _psql(admin_dsn, path, f"DBNAME={_dbname(admin_dsn)}")
        with psycopg.connect(admin_dsn, autocommit=True) as c:
            c.execute("insert into public.schema_migrations (name) values (%s)", (path.name,))
        applied.append(path.name)
    return applied


def seed(provisioner_dsn: str) -> None:
    _psql(provisioner_dsn, SQL / "seed" / "catalog.sql")


def lint(dsn: str) -> list[tuple]:
    problems: list[tuple] = []
    with psycopg.connect(dsn) as c:
        for name in ("check_rls.sql", "check_catalog.sql"):
            problems += [(name, *row) for row in c.execute((SQL / "lint" / name).read_text()).fetchall()]
    return problems


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv or argv[0] not in ("migrate", "seed", "lint"):
        print("usage: outpost migrate | seed | lint", file=sys.stderr)
        return 2
    if argv[0] == "migrate":
        dsn = os.environ.get("OUTPOST_ADMIN_DSN")
        if not dsn:
            print("OUTPOST_ADMIN_DSN is required for migrations", file=sys.stderr)
            return 2
        for name in migrate(dsn):
            print("applied", name)
    elif argv[0] == "seed":
        seed(os.environ["OUTPOST_PROVISIONER_DSN"])
        print("catalog seeded")
    else:
        problems = lint(os.environ.get("OUTPOST_ADMIN_DSN") or os.environ["OUTPOST_PROVISIONER_DSN"])
        for p in problems:
            print(" | ".join(str(x) for x in p))
        print(f"{len(problems)} problem(s)")
        return 1 if problems else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

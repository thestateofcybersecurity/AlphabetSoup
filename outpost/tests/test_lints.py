from conftest import Fixture, sql_files_match_docs

from outpost.cli import lint


def test_sql_lints_clean(fx: Fixture):
    assert lint(fx.settings.admin_dsn) == []


def test_sql_copies_match_design_docs():
    assert sql_files_match_docs() == []

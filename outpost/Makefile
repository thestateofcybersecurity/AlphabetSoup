.PHONY: setup migrate seed lint test run
setup:            ## create a venv and install in editable mode
	python -m venv .venv && .venv/bin/pip install -e ".[dev]"
migrate:          ## apply sql/migrations in order (bootstrap needs OUTPOST_ADMIN_DSN)
	.venv/bin/outpost migrate
seed:             ## load the catalog and run the catalog lint
	.venv/bin/outpost seed
lint:             ## ruff plus the RLS and catalog SQL lints
	.venv/bin/ruff check src tests && .venv/bin/outpost lint
test:             ## two-tenant isolation suite against a fresh outpost_test database
	.venv/bin/pytest -q
run:
	.venv/bin/uvicorn outpost.main:app --reload --port 8000

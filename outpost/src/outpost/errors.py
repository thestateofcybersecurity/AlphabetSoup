"""RFC 9457 problem details. Every error the API returns goes through Problem."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class Problem(Exception):
    def __init__(self, status: int, code: str, title: str, detail: str | None = None, errors: list | None = None):
        self.status, self.code, self.title, self.detail, self.errors = status, code, title, detail, errors


def not_found() -> Problem:
    """Cross-tenant and nonexistent ids are indistinguishable by design."""
    return Problem(404, "not_found", "Not found")


def forbidden(code: str, detail: str | None = None) -> Problem:
    return Problem(403, code, "Forbidden", detail)


def problem_response(request: Request, p: Problem) -> JSONResponse:
    body = {
        "type": f"https://outpost.example/problems/{p.code}",
        "title": p.title,
        "status": p.status,
        "code": p.code,
        "request_id": getattr(request.state, "request_id", None),
    }
    if p.detail:
        body["detail"] = p.detail
    if p.errors:
        body["errors"] = p.errors
    return JSONResponse(body, status_code=p.status, media_type="application/problem+json")


def install(app: FastAPI) -> None:
    @app.exception_handler(Problem)
    async def _problem(request: Request, exc: Problem):
        return problem_response(request, exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        errors = [{"field": ".".join(str(x) for x in e.get("loc", [])), "message": e.get("msg", "")} for e in exc.errors()]
        return problem_response(request, Problem(422, "validation_failed", "Validation failed", errors=errors))

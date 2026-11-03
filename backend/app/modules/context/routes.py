"""API de solo lectura para el contexto externo.

Requiere sesión autenticada. No acepta escrituras, no genera alertas y no
mezcla los agregados externos con los KPI internos de la empresa.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request
from sqlalchemy import func

from ...common.http import error, iso, money, pagination
from ...extensions import db
from ...models import ExternalDatasetVersion, ExternalSource, SectorBenchmark, TaxCollection
from ...security import require_auth

context_bp = Blueprint("context", __name__, url_prefix="/api/v1/context")

DISCLAIMER = (
    "Contexto externo agregado. No es una obligación tributaria de la empresa, "
    "no se une por NIT y no alimenta el pronóstico ni las alertas."
)


def _version_dict(version: ExternalDatasetVersion | None) -> dict | None:
    if version is None:
        return None
    return {
        "id": version.id,
        "version_label": version.version_label,
        "identity_sha256": version.identity_sha256,
        "acquired_at": iso(version.acquired_at),
        "cutoff_date": version.cutoff_date.isoformat() if version.cutoff_date else None,
        "period_start": version.period_start.isoformat() if version.period_start else None,
        "period_end": version.period_end.isoformat() if version.period_end else None,
        "is_partial": version.is_partial,
        "is_preliminary": version.is_preliminary,
        "status": version.status,
        "row_count": version.row_count,
        "file_name": version.file_name,
        "source_updated_at": iso(version.source_updated_at),
        "is_current": version.is_current,
        "notes": version.notes,
    }


def _source_dict(source: ExternalSource) -> dict:
    current = next((version for version in source.versions if version.is_current), None)
    return {
        "code": source.code,
        "name": source.name,
        "publisher": source.publisher,
        "dataset_id": source.dataset_id,
        "source_url": source.source_url,
        "metadata_url": source.metadata_url,
        "attribution": source.attribution,
        "attribution_url": source.attribution_url,
        "license": {
            "name": source.license_name,
            "id": source.license_id,
            "url": source.license_url,
            "status": source.license_status,
            "evidence_path": source.license_evidence_path,
        },
        "cadence": source.cadence,
        "description": source.description,
        "is_active": source.is_active,
        "version_count": len(source.versions),
        "current_version": _version_dict(current),
    }


def _current(source_code: str) -> tuple[ExternalSource | None, ExternalDatasetVersion | None]:
    source = db.session.query(ExternalSource).filter_by(code=source_code).first()
    if source is None:
        return None, None
    version = (
        db.session.query(ExternalDatasetVersion)
        .filter_by(source_id=source.id, is_current=True)
        .first()
    )
    return source, version


@context_bp.get("/sources")
@require_auth
def list_sources():
    sources = db.session.query(ExternalSource).order_by(ExternalSource.code.asc()).all()
    return jsonify({"items": [_source_dict(source) for source in sources], "disclaimer": DISCLAIMER})


@context_bp.get("/sources/<string:code>")
@require_auth
def source_detail(code: str):
    source = db.session.query(ExternalSource).filter_by(code=code).first()
    if source is None:
        return error("not_found", "Fuente no encontrada", 404)
    versions = (
        db.session.query(ExternalDatasetVersion)
        .filter_by(source_id=source.id)
        .order_by(ExternalDatasetVersion.acquired_at.desc())
        .all()
    )
    data = _source_dict(source)
    data["versions"] = [_version_dict(version) for version in versions]
    data["disclaimer"] = DISCLAIMER
    return jsonify(data)


@context_bp.get("/summary")
@require_auth
def summary():
    sources = db.session.query(ExternalSource).order_by(ExternalSource.code.asc()).all()
    tax: dict = {}
    benchmarks: list[dict] = []

    _, dian_version = _current("dian_recaudo")
    if dian_version is not None:
        annual = (
            db.session.query(TaxCollection)
            .filter_by(
                version_id=dian_version.id,
                scope="national",
                frequency="annual",
                series_code="total_dian",
            )
            .order_by(TaxCollection.period_year.desc())
            .first()
        )
        monthly = (
            db.session.query(TaxCollection)
            .filter_by(
                version_id=dian_version.id,
                scope="national",
                frequency="monthly",
                series_code="total",
            )
            .order_by(TaxCollection.period_year.desc(), TaxCollection.period_month.desc())
            .first()
        )
        if annual is not None:
            department_total = (
                db.session.query(func.coalesce(func.sum(TaxCollection.value_cop), 0))
                .filter_by(
                    version_id=dian_version.id,
                    scope="department",
                    frequency="annual",
                    series_code="total",
                    period_year=annual.period_year,
                )
                .scalar()
                or 0
            )
            tax = {
                "version_label": dian_version.version_label,
                "annual": {
                    "year": annual.period_year,
                    "total_cop": money(annual.value_cop),
                    "is_preliminary": annual.is_preliminary,
                },
                "monthly": None
                if monthly is None
                else {
                    "year": monthly.period_year,
                    "month": monthly.period_month,
                    "total_cop": money(monthly.value_cop),
                    "is_preliminary": monthly.is_preliminary,
                },
                "departments": {
                    "year": annual.period_year,
                    "total_cop": money(department_total),
                },
            }

    _, super_version = _current("supersociedades_top10000")
    if super_version is not None:
        latest_year = (
            db.session.query(func.max(SectorBenchmark.year))
            .filter(SectorBenchmark.version_id == super_version.id)
            .scalar()
        )
        if latest_year is not None:
            rows = (
                db.session.query(SectorBenchmark)
                .filter_by(version_id=super_version.id, year=latest_year, sector="ALL")
                .order_by(SectorBenchmark.metric.asc())
                .all()
            )
            benchmarks = [
                {
                    "year": row.year,
                    "metric": row.metric,
                    "metric_label": row.metric_label,
                    "sample_size": row.sample_size,
                    "total_cop": money(row.total_cop),
                    "median_cop": money(row.median_cop),
                    "mean_cop": money(row.mean_cop),
                    "zero_count": row.zero_count,
                    "negative_count": row.negative_count,
                }
                for row in rows
            ]

    return jsonify(
        {
            "sources": [_source_dict(source) for source in sources],
            "tax": tax,
            "benchmarks": benchmarks,
            "disclaimer": DISCLAIMER,
        }
    )


@context_bp.get("/tax-collections")
@require_auth
def list_tax_collections():
    source_code = request.args.get("source", "dian_recaudo")
    source, version = _current(source_code)
    if source is None:
        return error("not_found", "Fuente no encontrada", 404)
    if version is None:
        return jsonify(
            {
                "items": [],
                "meta": {"source": source_code, "version_label": None, "total": 0},
                "disclaimer": DISCLAIMER,
            }
        )

    query = db.session.query(TaxCollection).filter_by(version_id=version.id)
    if request.args.get("scope"):
        query = query.filter(TaxCollection.scope == request.args["scope"])
    if request.args.get("frequency"):
        query = query.filter(TaxCollection.frequency == request.args["frequency"])
    if request.args.get("year"):
        query = query.filter(TaxCollection.period_year == int(request.args["year"]))
    if request.args.get("month"):
        query = query.filter(TaxCollection.period_month == int(request.args["month"]))
    if request.args.get("department"):
        query = query.filter(TaxCollection.department_name == request.args["department"])
    if request.args.get("series"):
        query = query.filter(TaxCollection.series_code == request.args["series"])

    page, size = pagination()
    total = query.count()
    rows = (
        query.order_by(
            TaxCollection.period_year.desc(),
            TaxCollection.period_month.desc(),
            TaxCollection.series_code.asc(),
        )
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    return jsonify(
        {
            "items": [
                {
                    "scope": row.scope,
                    "frequency": row.frequency,
                    "period_year": row.period_year,
                    "period_month": row.period_month,
                    "department_name": row.department_name,
                    "series_code": row.series_code,
                    "series_label": row.series_label,
                    "value_cop": money(row.value_cop),
                    "is_preliminary": row.is_preliminary,
                }
                for row in rows
            ],
            "meta": {
                "source": source_code,
                "version_label": version.version_label,
                "license_status": source.license_status,
                "total": total,
                "page": page,
                "page_size": size,
            },
            "disclaimer": DISCLAIMER,
        }
    )


@context_bp.get("/sector-benchmarks")
@require_auth
def list_sector_benchmarks():
    source_code = request.args.get("source", "supersociedades_top10000")
    source, version = _current(source_code)
    if source is None:
        return error("not_found", "Fuente no encontrada", 404)
    if version is None:
        return jsonify(
            {
                "items": [],
                "meta": {"source": source_code, "version_label": None, "total": 0},
                "disclaimer": DISCLAIMER,
            }
        )

    query = db.session.query(SectorBenchmark).filter_by(version_id=version.id)
    if request.args.get("year"):
        query = query.filter(SectorBenchmark.year == int(request.args["year"]))
    if request.args.get("metric"):
        query = query.filter(SectorBenchmark.metric == request.args["metric"])
    if request.args.get("sector"):
        query = query.filter(SectorBenchmark.sector == request.args["sector"])

    page, size = pagination()
    total = query.count()
    rows = (
        query.order_by(
            SectorBenchmark.year.desc(),
            SectorBenchmark.metric.asc(),
            SectorBenchmark.sector.asc(),
        )
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    return jsonify(
        {
            "items": [
                {
                    "year": row.year,
                    "metric": row.metric,
                    "metric_label": row.metric_label,
                    "sector": row.sector,
                    "sample_size": row.sample_size,
                    "total_cop": money(row.total_cop),
                    "mean_cop": money(row.mean_cop),
                    "median_cop": money(row.median_cop),
                    "p25_cop": money(row.p25_cop),
                    "p75_cop": money(row.p75_cop),
                    "min_cop": money(row.min_cop),
                    "max_cop": money(row.max_cop),
                    "zero_count": row.zero_count,
                    "negative_count": row.negative_count,
                }
                for row in rows
            ],
            "meta": {
                "source": source_code,
                "version_label": version.version_label,
                "license_status": source.license_status,
                "total": total,
                "page": page,
                "page_size": size,
            },
            "disclaimer": DISCLAIMER,
        }
    )

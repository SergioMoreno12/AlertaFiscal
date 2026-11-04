"""Tests of the external context: loading, versioning and read-only API."""
from __future__ import annotations

import csv
import hashlib
import json
import uuid
from pathlib import Path

from app.extensions import db
from app.models import Alert, ExternalDatasetVersion, ExternalSource, ReserveEntry, SectorBenchmark, TaxCollection

TAX_FIELDS = [
    "scope",
    "frequency",
    "period_year",
    "period_month",
    "department_name",
    "series_code",
    "series_label",
    "value_cop",
    "is_preliminary",
]

BENCHMARK_FIELDS = [
    "year",
    "metric",
    "metric_label",
    "sector",
    "sample_size",
    "total_cop",
    "mean_cop",
    "median_cop",
    "p25_cop",
    "p75_cop",
    "min_cop",
    "max_cop",
    "zero_count",
    "negative_count",
]


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> str:
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _manifest(
    tmp_path: Path,
    *,
    code: str,
    label: str,
    tax_rows: list[dict],
    benchmark_rows: list[dict],
    acquired_at: str,
    suffix: str,
) -> Path:
    tax_path = tmp_path / f"{code}_{label}_tax.csv"
    benchmark_path = tmp_path / f"{code}_{label}_bench.csv"
    tax_sha = _write_csv(tax_path, TAX_FIELDS, tax_rows)
    benchmark_sha = _write_csv(benchmark_path, BENCHMARK_FIELDS, benchmark_rows)
    identity = hashlib.sha256(f"{code}|{label}|{suffix}".encode()).hexdigest()
    payload = {
        "manifest_version": 1,
        "source": {
            "code": code,
            "name": "Test source",
            "publisher": "Test publisher",
            "dataset_id": "test-123",
            "source_url": "https://example.invalid/dataset",
            "metadata_url": "https://example.invalid/metadata",
            "attribution": "Test publisher",
            "attribution_url": "https://example.invalid",
            "license": {
                "name": "CC BY-SA 4.0",
                "license_id": "CC_40_BY_SA",
                "terms_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                "status": "verified",
                "evidence_path": "docs/evidence/test.json",
            },
            "cadence": "Irregular",
            "description": "Test context",
        },
        "version": {
            "version_label": label,
            "identity_sha256": identity,
            "acquired_at": acquired_at,
            "cutoff_date": "2025-12-31",
            "period_start": "2025-01-01",
            "period_end": "2025-12-31",
            "is_partial": False,
            "is_preliminary": False,
            "status": "succeeded",
            "source_updated_at": "2025-12-31T00:00:00Z",
            "row_count": len(tax_rows) + len(benchmark_rows),
            "file": {"file_name": tax_path.name, "sha256": identity},
            "processed": [
                {"table": "tax_collections", "path": str(tax_path), "sha256": tax_sha, "rows": len(tax_rows)},
                {
                    "table": "sector_benchmarks",
                    "path": str(benchmark_path),
                    "sha256": benchmark_sha,
                    "rows": len(benchmark_rows),
                },
            ],
            "notes": ["Test data, not real."],
        },
    }
    manifest_path = tmp_path / f"{code}_{label}.json"
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def _tax_row(year: int, month: int | None, series: str, value: str) -> dict:
    return {
        "scope": "national",
        "frequency": "monthly" if month else "annual",
        "period_year": year,
        "period_month": month or "",
        "department_name": "",
        "series_code": series,
        "series_label": series.replace("_", " ").title(),
        "value_cop": value,
        "is_preliminary": "false",
    }


def _benchmark_row(year: int, metric: str, sector: str, total: str) -> dict:
    return {
        "year": year,
        "metric": metric,
        "metric_label": metric.replace("_", " ").title(),
        "sector": sector,
        "sample_size": 10,
        "total_cop": total,
        "mean_cop": "100.00",
        "median_cop": "90.00",
        "p25_cop": "50.00",
        "p75_cop": "150.00",
        "min_cop": "0.00",
        "max_cop": "500.00",
        "zero_count": 1,
        "negative_count": 0,
    }


def _cleanup(code: str) -> None:
    source = db.session.query(ExternalSource).filter_by(code=code).first()
    if source is not None:
        db.session.delete(source)
        db.session.commit()


def test_load_is_idempotent_and_does_not_create_alerts(app, client, auth, tmp_path):
    from app.modules.context.loader import load_manifest_file

    code = f"test_source_{uuid.uuid4().hex[:10]}"
    manifest = _manifest(
        tmp_path,
        code=code,
        label="20260101T000000Z",
        tax_rows=[
            _tax_row(2025, None, "total_dian", "1000000.00"),
            _tax_row(2025, 9, "total", "800000.00"),
        ],
        benchmark_rows=[_benchmark_row(2025, "total_activos", "ALL", "5000000.00")],
        acquired_at="2026-01-01T00:00:00Z",
        suffix="v1",
    )

    with app.app_context():
        before_alerts = db.session.query(Alert).count()
        first = load_manifest_file(manifest)
        second = load_manifest_file(manifest)
        after_alerts = db.session.query(Alert).count()
        assert first["status"] == "loaded"
        assert second["status"] == "skipped"
        assert first["counts"] == {"tax_collections": 2, "sector_benchmarks": 1}
        assert after_alerts == before_alerts
        source = db.session.query(ExternalSource).filter_by(code=code).one()
        assert source.license_status == "verified"
        assert len(source.versions) == 1
        version = source.versions[0]
        assert version.is_current is True
        assert db.session.query(TaxCollection).filter_by(version_id=version.id).count() == 2
        assert db.session.query(SectorBenchmark).filter_by(version_id=version.id).count() == 1

    # API autenticada
    sources = client.get("/api/v1/context/sources")
    assert sources.status_code == 200
    assert any(item["code"] == code for item in sources.get_json()["items"])

    summary = client.get("/api/v1/context/summary")
    assert summary.status_code == 200
    assert "disclaimer" in summary.get_json()

    tax = client.get(f"/api/v1/context/tax-collections?source={code}&frequency=annual")
    assert tax.status_code == 200
    body = tax.get_json()
    assert body["meta"]["total"] == 1
    assert body["items"][0]["value_cop"] == "1000000.00"

    benchmarks = client.get(f"/api/v1/context/sector-benchmarks?source={code}&sector=ALL")
    assert benchmarks.status_code == 200
    assert benchmarks.get_json()["items"][0]["metric"] == "total_activos"

    detail = client.get(f"/api/v1/context/sources/{code}")
    assert detail.status_code == 200
    assert len(detail.get_json()["versions"]) == 1

    # Without a session there is no read access.
    anonymous = app.test_client()
    assert anonymous.get("/api/v1/context/sources").status_code == 401
    # Read only: there is no write endpoint.
    assert (
        client.post(
            "/api/v1/context/sources", headers={"X-CSRF-Token": auth["csrf"]}
        ).status_code
        == 405
    )

    with app.app_context():
        _cleanup(code)


def test_new_version_preserves_previous_facts(app, client, auth, tmp_path):
    from app.modules.context.loader import load_manifest_file

    code = f"test_source_{uuid.uuid4().hex[:10]}"
    first_manifest = _manifest(
        tmp_path,
        code=code,
        label="20260101T000000Z",
        tax_rows=[_tax_row(2025, None, "total_dian", "1000000.00")],
        benchmark_rows=[],
        acquired_at="2026-01-01T00:00:00Z",
        suffix="v1",
    )
    second_manifest = _manifest(
        tmp_path,
        code=code,
        label="20260201T000000Z",
        tax_rows=[_tax_row(2025, None, "total_dian", "1200000.00")],
        benchmark_rows=[],
        acquired_at="2026-02-01T00:00:00Z",
        suffix="v2",
    )

    with app.app_context():
        load_manifest_file(first_manifest)
        load_manifest_file(second_manifest)
        source = db.session.query(ExternalSource).filter_by(code=code).one()
        versions = (
            db.session.query(ExternalDatasetVersion)
            .filter_by(source_id=source.id)
            .order_by(ExternalDatasetVersion.acquired_at.asc())
            .all()
        )
        assert len(versions) == 2
        assert versions[0].is_current is False
        assert versions[1].is_current is True
        # Facts of the previous version are not deleted when the new one loads.
        assert db.session.query(TaxCollection).filter_by(version_id=versions[0].id).count() == 1
        assert db.session.query(TaxCollection).filter_by(version_id=versions[1].id).count() == 1

    current = client.get(f"/api/v1/context/tax-collections?source={code}")
    assert current.status_code == 200
    assert current.get_json()["meta"]["version_label"] == "20260201T000000Z"
    assert current.get_json()["items"][0]["value_cop"] == "1200000.00"

    detail = client.get(f"/api/v1/context/sources/{code}").get_json()
    assert len(detail["versions"]) == 2

    with app.app_context():
        _cleanup(code)


def test_versioning_plan_does_not_lose_or_duplicate_reserves(app, auth):
    client = auth["client"]
    headers = {"X-CSRF-Token": auth["csrf"]}

    plan_response = client.post(
        "/api/v1/companies/1/plans",
        json={
            "name": "Plan reservas",
            "period": "2026-10",
            "projected_income": "1000.00",
            "projected_expenses": "600.00",
            "estimated_reserve": "100.00",
        },
        headers=headers,
    )
    assert plan_response.status_code == 201, plan_response.get_json()
    plan = plan_response.get_json()
    version_one = plan["version"]["id"]

    reserve_response = client.post(
        "/api/v1/companies/1/reserve-entries",
        json={
            "amount": "40.00",
            "reserved_on": "2026-10-01",
            "plan_version_id": version_one,
            "note": "Reserve linked to version 1",
        },
        headers=headers,
    )
    assert reserve_response.status_code == 201, reserve_response.get_json()
    reserve_id = reserve_response.get_json()["id"]

    new_version = client.post(
        f"/api/v1/companies/1/plans/{plan['id']}/versions",
        json={
            "projected_income": "1200.00",
            "projected_expenses": "700.00",
            "estimated_reserve": "150.00",
        },
        headers=headers,
    )
    assert new_version.status_code == 201, new_version.get_json()
    version_two = new_version.get_json()["version"]["id"]
    assert version_two != version_one

    listed = client.get("/api/v1/companies/1/reserve-entries").get_json()
    matching = [item for item in listed["items"] if item["id"] == reserve_id]
    assert len(matching) == 1
    assert matching[0]["plan_version_id"] == version_one
    assert matching[0]["amount"] == "40.00"
    assert listed["total"] == "40.00"

    second_reserve = client.post(
        "/api/v1/companies/1/reserve-entries",
        json={
            "amount": "60.00",
            "reserved_on": "2026-10-02",
            "plan_version_id": version_two,
            "note": "Additional reserve of version 2",
        },
        headers=headers,
    )
    assert second_reserve.status_code == 201, second_reserve.get_json()

    after = client.get("/api/v1/companies/1/reserve-entries").get_json()
    ids = [item["id"] for item in after["items"]]
    assert len(ids) == len(set(ids)), "The reserve must not be duplicated when versioning"
    assert after["total"] == "100.00"
    assert sum(1 for item in after["items"] if item["id"] == reserve_id) == 1

    with app.app_context():
        from app.models import FiscalPlan, FiscalPlanVersion

        db.session.query(ReserveEntry).filter(
            ReserveEntry.id.in_([reserve_id, second_reserve.get_json()["id"]])
        ).delete(synchronize_session=False)
        # Delete the versions first: in SQLite the plan id is reused and
        # an orphan version would break the next plan with the same id.
        db.session.query(FiscalPlanVersion).filter(
            FiscalPlanVersion.plan_id == plan["id"]
        ).delete(synchronize_session=False)
        db.session.query(FiscalPlan).filter(FiscalPlan.id == plan["id"]).delete(
            synchronize_session=False
        )
        db.session.commit()

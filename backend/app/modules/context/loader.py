"""Idempotent loading of external context manifests.

It does not download, train or create alerts. It only stores sources,
acquisition versions and aggregates already processed by ``ml/company_trainer/sources``.
"""
from __future__ import annotations

import csv
import hashlib
import json
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import func

from ...common.http import record_audit
from ...extensions import db
from ...models import (
    ExternalDatasetVersion,
    ExternalSource,
    SectorBenchmark,
    TaxCollection,
    utcnow,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
CHUNK_SIZE = 1000
FACT_TABLES = {"tax_collections", "sector_benchmarks"}


class ManifestError(ValueError):
    """Invalid manifest or processed file."""


def _resolve_path(raw: str) -> Path:
    path = Path(str(raw))
    if path.is_absolute():
        return path
    for base in (REPO_ROOT, Path.cwd()):
        candidate = base / path
        if candidate.exists():
            return candidate
    return REPO_ROOT / path


def _parse_date(raw) -> date | None:
    if raw in (None, ""):
        return None
    return date.fromisoformat(str(raw)[:10])


def _parse_datetime(raw) -> datetime | None:
    if raw in (None, ""):
        return None
    text = str(raw).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    value = datetime.fromisoformat(text)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _decimal(raw, field: str) -> Decimal:
    try:
        return Decimal(str(raw)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError) as exc:
        raise ManifestError(f"Invalid decimal value in {field}: {raw!r}") from exc


def _int(raw, field: str) -> int:
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError) as exc:
        raise ManifestError(f"Invalid integer in {field}: {raw!r}") from exc


def _bool(raw) -> bool:
    return str(raw).strip().lower() in ("true", "1", "yes", "si", "sí")


def _row_key(*parts) -> str:
    payload = "|".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _processed(manifest: dict) -> dict[str, dict]:
    entries = manifest["version"].get("processed") or []
    return {item["table"]: item for item in entries if item.get("table") in FACT_TABLES}


def _iter_tax_rows(path: Path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        for raw in csv.DictReader(handle):
            scope = (raw.get("scope") or "").strip()
            frequency = (raw.get("frequency") or "").strip()
            year = _int(raw.get("period_year"), "period_year")
            month = _int(raw["period_month"], "period_month") if raw.get("period_month") else None
            department = (raw.get("department_name") or "").strip() or None
            series_code = (raw.get("series_code") or "").strip()
            if not scope or not frequency or not series_code:
                raise ManifestError("Fila de recaudo incompleta")
            yield {
                "row_key": _row_key(scope, frequency, year, month, department, series_code),
                "scope": scope,
                "frequency": frequency,
                "period_year": year,
                "period_month": month,
                "department_name": department,
                "series_code": series_code,
                "series_label": (raw.get("series_label") or series_code).strip()[:200],
                "value_cop": _decimal(raw.get("value_cop"), "value_cop"),
                "is_preliminary": _bool(raw.get("is_preliminary")),
            }


def _iter_benchmark_rows(path: Path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        for raw in csv.DictReader(handle):
            yield {
                "year": _int(raw.get("year"), "year"),
                "metric": (raw.get("metric") or "").strip(),
                "metric_label": (raw.get("metric_label") or raw.get("metric") or "").strip()[:120],
                "sector": (raw.get("sector") or "ALL").strip()[:80],
                "sample_size": _int(raw.get("sample_size"), "sample_size"),
                "total_cop": _decimal(raw.get("total_cop"), "total_cop"),
                "mean_cop": _decimal(raw.get("mean_cop"), "mean_cop"),
                "median_cop": _decimal(raw.get("median_cop"), "median_cop"),
                "p25_cop": _decimal(raw.get("p25_cop"), "p25_cop"),
                "p75_cop": _decimal(raw.get("p75_cop"), "p75_cop"),
                "min_cop": _decimal(raw.get("min_cop"), "min_cop"),
                "max_cop": _decimal(raw.get("max_cop"), "max_cop"),
                "zero_count": _int(raw.get("zero_count"), "zero_count"),
                "negative_count": _int(raw.get("negative_count"), "negative_count"),
            }


def _chunks(iterable, size: int):
    batch = []
    for item in iterable:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _count_rows(model, version_id: int) -> int:
    return db.session.query(func.count(model.id)).filter(model.version_id == version_id).scalar() or 0


def _clear_facts(version_id: int) -> None:
    db.session.query(TaxCollection).filter(TaxCollection.version_id == version_id).delete(
        synchronize_session=False
    )
    db.session.query(SectorBenchmark).filter(SectorBenchmark.version_id == version_id).delete(
        synchronize_session=False
    )
    db.session.flush()


def _load_facts(version: ExternalDatasetVersion, manifest: dict) -> dict:
    entries = _processed(manifest)
    tax_entry = entries.get("tax_collections")
    benchmark_entry = entries.get("sector_benchmarks")
    if tax_entry is None and benchmark_entry is None:
        raise ManifestError("The manifest declares no processed context files")

    _clear_facts(version.id)
    counts = {"tax_collections": 0, "sector_benchmarks": 0}

    if tax_entry is not None:
        path = _resolve_path(tax_entry["path"])
        if not path.exists():
            raise ManifestError(f"The processed CSV does not exist: {path}")
        for batch in _chunks(_iter_tax_rows(path), CHUNK_SIZE):
            db.session.bulk_insert_mappings(
                TaxCollection, [{**row, "version_id": version.id} for row in batch]
            )
            counts["tax_collections"] += len(batch)

    if benchmark_entry is not None:
        path = _resolve_path(benchmark_entry["path"])
        if not path.exists():
            raise ManifestError(f"The processed CSV does not exist: {path}")
        for batch in _chunks(_iter_benchmark_rows(path), CHUNK_SIZE):
            db.session.bulk_insert_mappings(
                SectorBenchmark, [{**row, "version_id": version.id} for row in batch]
            )
            counts["sector_benchmarks"] += len(batch)

    for table, expected in (
        ("tax_collections", (tax_entry or {}).get("rows")),
        ("sector_benchmarks", (benchmark_entry or {}).get("rows")),
    ):
        if expected is not None and int(expected) != counts[table]:
            raise ManifestError(
                f"Conteo inesperado en {table}: {counts[table]} cargados, {expected} declarados"
            )
    return counts


def _expected_counts(manifest: dict) -> dict:
    entries = _processed(manifest)
    return {
        "tax_collections": int((entries.get("tax_collections") or {}).get("rows", 0)),
        "sector_benchmarks": int((entries.get("sector_benchmarks") or {}).get("rows", 0)),
    }


def _upsert_source(data: dict) -> ExternalSource:
    code = str(data.get("code") or "").strip()
    if not code:
        raise ManifestError("The manifest does not declare source.code")
    source = db.session.query(ExternalSource).filter_by(code=code).first()
    license_data = data.get("license") or {}
    values = {
        "name": str(data.get("name") or code)[:200],
        "publisher": str(data.get("publisher") or "")[:200],
        "dataset_id": (str(data["dataset_id"])[:80] if data.get("dataset_id") else None),
        "source_url": str(data.get("source_url") or "")[:500],
        "metadata_url": (str(data["metadata_url"])[:500] if data.get("metadata_url") else None),
        "attribution": str(data.get("attribution") or "")[:300],
        "attribution_url": (str(data["attribution_url"])[:500] if data.get("attribution_url") else None),
        "license_name": str(license_data.get("name") or "")[:200],
        "license_id": (str(license_data["license_id"])[:80] if license_data.get("license_id") else None),
        "license_url": (str(license_data["terms_url"])[:500] if license_data.get("terms_url") else None),
        "license_status": str(license_data.get("status") or "uncertain")[:20],
        "license_evidence_path": (
            str(license_data["evidence_path"])[:300] if license_data.get("evidence_path") else None
        ),
        "cadence": str(data.get("cadence") or "")[:300],
        "description": str(data.get("description") or ""),
        "is_active": True,
    }
    if source is None:
        source = ExternalSource(code=code, **values)
        db.session.add(source)
        db.session.flush()
    else:
        for key, value in values.items():
            setattr(source, key, value)
    return source


def load_manifest_file(path: str | Path, *, dry_run: bool = False, replace: bool = False) -> dict:
    manifest_path = Path(path)
    if not manifest_path.exists():
        raise ManifestError(f"The manifest does not exist: {manifest_path}")
    payload = manifest_path.read_bytes()
    manifest = json.loads(payload.decode("utf-8"))
    if not isinstance(manifest, dict) or "source" not in manifest or "version" not in manifest:
        raise ManifestError("Invalid manifest: 'source' or 'version' is missing")

    version_data = manifest["version"]
    status = str(version_data.get("status") or "succeeded")
    identity = (
        version_data.get("identity_sha256")
        or (version_data.get("file") or {}).get("sha256")
        or hashlib.sha256(payload).hexdigest()
    )
    expected = _expected_counts(manifest)

    if dry_run:
        entries = _processed(manifest)
        for table, entry in entries.items():
            resolved = _resolve_path(entry["path"])
            if not resolved.exists():
                raise ManifestError(f"The processed file for {table} does not exist: {resolved}")
        return {
            "status": "dry_run",
            "source": manifest["source"].get("code"),
            "version_label": version_data.get("version_label"),
            "identity_sha256": identity,
            "expected": expected,
        }

    source = _upsert_source(manifest["source"])
    version = (
        db.session.query(ExternalDatasetVersion)
        .filter_by(source_id=source.id, identity_sha256=identity)
        .first()
    )

    created = version is None
    previous_manifest_sha = None
    if version is None:
        version = ExternalDatasetVersion(
            source_id=source.id,
            version_label=str(version_data.get("version_label") or identity[:12])[:40],
            identity_sha256=identity,
            acquired_at=_parse_datetime(version_data.get("acquired_at")) or utcnow(),
            cutoff_date=_parse_date(version_data.get("cutoff_date")),
            period_start=_parse_date(version_data.get("period_start")),
            period_end=_parse_date(version_data.get("period_end")),
            is_partial=bool(version_data.get("is_partial")),
            is_preliminary=bool(version_data.get("is_preliminary")),
            status=status[:20],
            row_count=int(version_data.get("row_count") or 0),
            file_name=(
                str((version_data.get("file") or {}).get("file_name"))
                if (version_data.get("file") or {}).get("file_name")
                else None
            ),
            manifest_path=str(manifest_path),
            manifest_sha256=hashlib.sha256(payload).hexdigest(),
            source_updated_at=_parse_datetime(version_data.get("source_updated_at")),
            is_current=False,
            notes="\n".join(str(note) for note in version_data.get("notes") or []),
        )
        db.session.add(version)
        db.session.flush()
    else:
        previous_manifest_sha = version.manifest_sha256
        version.status = status[:20]
        version.manifest_path = str(manifest_path)
        version.manifest_sha256 = hashlib.sha256(payload).hexdigest()
        version.notes = "\n".join(str(note) for note in version_data.get("notes") or [])
        version.source_updated_at = _parse_datetime(version_data.get("source_updated_at")) or version.source_updated_at

    counts = {
        "tax_collections": _count_rows(TaxCollection, version.id),
        "sector_benchmarks": _count_rows(SectorBenchmark, version.id),
    }
    needs_load = (
        replace
        or created
        or counts != expected
        or (previous_manifest_sha is not None and previous_manifest_sha != version.manifest_sha256)
    )

    if status != "succeeded":
        version.is_current = False
        db.session.flush()
        record_audit(None, "context.record", f"external_version:{version.id}", {"status": status})
        db.session.commit()
        return {
            "status": "recorded_not_loaded",
            "source": source.code,
            "version_label": version.version_label,
            "version_id": version.id,
            "acquisition_status": status,
            "counts": counts,
        }

    if not needs_load:
        result_status = "skipped"
    else:
        counts = _load_facts(version, manifest)
        result_status = "loaded"

    # The partial unique index requires clearing the previous version before
    # marking the new one as current.
    db.session.query(ExternalDatasetVersion).filter(
        ExternalDatasetVersion.source_id == source.id,
        ExternalDatasetVersion.id != version.id,
        ExternalDatasetVersion.is_current.is_(True),
    ).update({ExternalDatasetVersion.is_current: False}, synchronize_session=False)
    db.session.flush()
    version.is_current = True
    record_audit(
        None,
        "context.load",
        f"external_version:{version.id}",
        {
            "source": source.code,
            "version_label": version.version_label,
            "tax_collections": counts["tax_collections"],
            "sector_benchmarks": counts["sector_benchmarks"],
            "result": result_status,
        },
    )
    db.session.commit()
    return {
        "status": result_status,
        "source": source.code,
        "version_label": version.version_label,
        "version_id": version.id,
        "counts": counts,
        "is_current": True,
    }

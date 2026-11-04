"""Acquisition and verification of external sources.

Usage (from the repository root):

    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.acquire supersociedades
    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.acquire supersociedades --download
    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.acquire dian

The ``supersociedades`` command does not download again by default: it checks the
local file against the Socrata count and pagination. ``--download``
downloads a new copy into a versioned folder and never overwrites a
previous download.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .common import (
    BILLONES,
    DIAN_BASE_URL,
    DIAN_PAGE_URL,
    EVIDENCE_DIR,
    MANIFEST_DIR,
    PROCESSED_DIR,
    RAW_DIR,
    REPO_ROOT,
    SOCRATA_DOMAIN,
    SUPERSOCIEDADES_ID,
    SUPERSOCIEDADES_KEYS_URL,
    SUPERSOCIEDADES_METADATA_URL,
    SocrataClient,
    SourceError,
    billones_to_cop,
    ensure_dir,
    file_evidence,
    iso_z,
    manifest_path,
    parse_iso,
    parse_supersociedades_amount,
    relative_to_repo,
    require_file,
    sha256_file,
    sha256_text,
    utcnow,
    version_label,
    write_json,
)

SUPERSOCIEDADES_CODE = "supersociedades_top10000"
SUPERSOCIEDADES_ORDER = "nit,a_o_de_corte,raz_n_social"
DIAN_CODE = "dian_recaudo"

DIAN_FILES = [
    {
        "name": "Recaudo-anual-por-tipo-de-impuesto-1970-2026.xlsx",
        "kind": "annual",
        "url": f"{DIAN_BASE_URL}/Recaudo-anual-por-tipo-de-impuesto-1970-2026.xlsx",
    },
    {
        "name": "Recaudo-mensual-por-tipo-de-impuesto-2000-2026.xlsx",
        "kind": "monthly",
        "url": f"{DIAN_BASE_URL}/Recaudo-mensual-por-tipo-de-impuesto-2000-2026.xlsx",
    },
    {
        "name": "Recaudo-bruto-por-seccionales-y-tipo-de-impuesto-2005-2026.xlsx",
        "kind": "department",
        "url": f"{DIAN_BASE_URL}/Recaudo-bruto-por-seccionales-y-tipo-de-impuesto-2005-2026.xlsx",
    },
]


# ─────────────────────────── Supersociedades ───────────────────────────


def _norm_number(raw) -> str:
    if raw is None:
        return ""
    text = str(raw).strip()
    try:
        value = Decimal(text)
    except InvalidOperation:
        return text
    rendered = format(value, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered


def _canonical_row(row: dict) -> str:
    nit = _norm_number(row.get("nit"))
    year = _norm_number(row.get("a_o_de_corte"))
    name = " ".join(str(row.get("raz_n_social") or "").split())
    assets = parse_supersociedades_amount(row.get("total_activos"))
    return f"{nit}|{year}|{name}|{assets if assets is not None else ''}"


def _read_local_rows(path: Path) -> tuple[list[dict], list[str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        return rows, list(reader.fieldnames or [])


def _download_supersociedades(client: SocrataClient, page_size: int, label: str) -> tuple[Path, list[dict]]:
    total = client.count()
    destination = RAW_DIR / "supersociedades" / label / "dataset.csv"
    ensure_dir(destination.parent)
    pages: list[dict] = []
    fieldnames: list[str] | None = None
    written = 0
    offset = 0
    tmp = destination.with_suffix(".csv.tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as handle:
        writer = None
        while offset < total:
            payload = client.select(
                "*",
                order=SUPERSOCIEDADES_ORDER,
                limit=page_size,
                offset=offset,
                fmt="csv",
            )
            text = payload.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(text))
            rows = list(reader)
            if fieldnames is None:
                fieldnames = list(reader.fieldnames or [])
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
            if not rows:
                break
            for row in rows:
                writer.writerow(row)
            pages.append(
                {
                    "offset": offset,
                    "limit": page_size,
                    "returned": len(rows),
                    "first_key": _canonical_row(rows[0]),
                    "last_key": _canonical_row(rows[-1]),
                    "sha256": sha256_text("\n".join(_canonical_row(r) for r in rows)),
                }
            )
            written += len(rows)
            offset += len(rows)
    if written != total:
        tmp.unlink(missing_ok=True)
        raise SourceError(f"Incomplete download: {written} rows of {total} expected")
    tmp.replace(destination)
    return destination, pages


def _verify_pagination(client: SocrataClient, local_rows: list[dict], page_size: int) -> dict:
    total = client.count()
    local_keys = sorted(_canonical_row(row) for row in local_rows)
    local_hashes = sha256_text("\n".join(local_keys))
    pages: list[dict] = []
    remote_keys: list[str] = []
    offset = 0
    while offset < total:
        rows = client.select(
            "nit,a_o_de_corte,raz_n_social,total_activos",
            order=SUPERSOCIEDADES_ORDER,
            limit=page_size,
            offset=offset,
            fmt="json",
        )
        if not rows:
            break
        keys = [_canonical_row(row) for row in rows]
        remote_keys.extend(keys)
        pages.append(
            {
                "offset": offset,
                "limit": page_size,
                "returned": len(rows),
                "first_key": keys[0],
                "last_key": keys[-1],
                "sha256": sha256_text("\n".join(sorted(keys))),
            }
        )
        offset += len(rows)

    remote_sorted = sorted(remote_keys)
    remote_hashes = sha256_text("\n".join(remote_sorted))
    duplicate_keys = len(remote_keys) - len(set(remote_keys))
    evidence = {
        "method": "count + stable pagination",
        "endpoint": SUPERSOCIEDADES_KEYS_URL,
        "order": SUPERSOCIEDADES_ORDER,
        "page_size": page_size,
        "api_count": total,
        "local_rows": len(local_rows),
        "downloaded_rows": len(remote_keys),
        "pages": len(pages),
        "duplicate_keys_in_pagination": duplicate_keys,
        "local_keys_sha256": local_hashes,
        "remote_keys_sha256": remote_hashes,
        "keys_match": local_hashes == remote_hashes,
        "page_evidence": pages,
    }
    if len(remote_keys) != total:
        raise SourceError(f"The pagination returned {len(remote_keys)} rows; the count declares {total}")
    if duplicate_keys:
        raise SourceError(f"The pagination returned {duplicate_keys} duplicate keys")
    if len(local_rows) != total:
        raise SourceError(
            f"The local file has {len(local_rows)} rows; Socrata declares {total}. "
            "The original download may have been truncated."
        )
    if local_hashes != remote_hashes:
        raise SourceError(
            "The local keys do not match the remote pagination. "
            "The source may have been updated after the download; keep the original and document the change."
        )
    return evidence


def _license_evidence(metadata: dict, retrieved_at: datetime) -> dict:
    license_obj = metadata.get("license") or {}
    return {
        "source_code": SUPERSOCIEDADES_CODE,
        "dataset_id": SUPERSOCIEDADES_ID,
        "metadata_url": SUPERSOCIEDADES_METADATA_URL,
        "retrieved_at": iso_z(retrieved_at),
        "license_id": {
            "field": "licenseId",
            "value": metadata.get("licenseId"),
        },
        "license_name": {
            "field": "license.name",
            "value": license_obj.get("name"),
        },
        "license_terms": {
            "field": "license.termsLink",
            "value": license_obj.get("termsLink"),
        },
        "attribution": {
            "field": "attribution",
            "value": metadata.get("attribution"),
        },
        "attribution_link": {
            "field": "attributionLink",
            "value": metadata.get("attributionLink"),
        },
        "conclusion": "CC BY-SA 4.0 (Creative Commons Attribution-ShareAlike 4.0 International)",
        "caveats": [
            "The field license.logoUrl points to a file named cc30bysa.png; "
            "licenseId=CC_40_BY_SA and termsLink=by-sa/4.0/legalcode take priority.",
            "The attribution must be kept and adaptations must be shared under the same license.",
        ],
    }


def acquire_supersociedades(args) -> dict:
    client = SocrataClient(SUPERSOCIEDADES_ID, SOCRATA_DOMAIN)
    metadata = client.metadata()
    metadata_path = RAW_DIR / "supersociedades_metadata.json"
    ensure_dir(metadata_path.parent)
    write_json(metadata_path, metadata)

    if args.raw:
        raw_path = Path(args.raw)
    else:
        raw_path = RAW_DIR / "supersociedades_10000_empresas.csv"

    pages: list[dict] = []
    if args.download or not raw_path.exists():
        label = args.version_label or version_label()
        raw_path, pages = _download_supersociedades(client, args.page_size, label)
        acquired_at = utcnow()
    else:
        acquired_at = datetime.fromtimestamp(raw_path.stat().st_mtime, tz=timezone.utc)

    local_rows, fieldnames = _read_local_rows(raw_path)
    integrity = _verify_pagination(client, local_rows, args.page_size)
    if pages:
        integrity["download_pages"] = pages

    years = sorted({int(Decimal(str(row["a_o_de_corte"]))) for row in local_rows if row.get("a_o_de_corte")})
    if not years:
        raise SourceError("The years of the dataset could not be determined")
    label = args.version_label or version_label(acquired_at)
    evidence = _license_evidence(metadata, utcnow())
    evidence_path = EVIDENCE_DIR / "supersociedades-license.json"
    write_json(evidence_path, evidence)
    raw_evidence = file_evidence(raw_path)

    manifest = {
        "manifest_version": 1,
        "generated_at": iso_z(utcnow()),
        "source": {
            "code": SUPERSOCIEDADES_CODE,
            "name": metadata.get("name"),
            "publisher": "Superintendencia de Sociedades (Supersociedades)",
            "dataset_id": SUPERSOCIEDADES_ID,
            "source_url": f"{SOCRATA_DOMAIN}/Comercio-Industria-y-Turismo/10-000-Empresas-mas-Grandes-del-Pa-s/{SUPERSOCIEDADES_ID}",
            "metadata_url": SUPERSOCIEDADES_METADATA_URL,
            "attribution": metadata.get("attribution"),
            "attribution_url": metadata.get("attributionLink"),
            "license": {
                "name": (metadata.get("license") or {}).get("name"),
                "license_id": metadata.get("licenseId"),
                "terms_url": (metadata.get("license") or {}).get("termsLink"),
                "status": "verified",
                "evidence_path": relative_to_repo(evidence_path),
            },
            "cadence": (
                "Irregular: the publisher updates the dataset without a fixed calendar. "
                "A monthly frequency must not be assumed."
            ),
            "description": metadata.get("description"),
        },
        "version": {
            "version_label": label,
            "identity_sha256": raw_evidence["sha256"],
            "acquired_at": iso_z(acquired_at),
            "cutoff_date": f"{max(years)}-12-31",
            "period_start": f"{min(years)}-01-01",
            "period_end": f"{max(years)}-12-31",
            "is_partial": False,
            "is_preliminary": False,
            "status": "succeeded",
            "source_updated_at": iso_z(datetime.fromtimestamp(metadata["rowsUpdatedAt"], tz=timezone.utc))
            if metadata.get("rowsUpdatedAt")
            else None,
            "row_count": len(local_rows),
            "column_count": len(fieldnames),
            "columns": fieldnames,
            "file": raw_evidence,
            "integrity": integrity,
            "processed": [],
            "notes": [
                "Figures published in trillions of pesos (10^12 COP), not in billions.",
                "The dataset covers the 10,000 largest companies; it does not represent all companies.",
                "The data is used only as aggregated context; it is not joined by NIT with the ERP.",
            ],
        },
    }
    target = manifest_path(SUPERSOCIEDADES_CODE, label)
    write_json(target, manifest)
    return {"manifest": relative_to_repo(target), "integrity": integrity, "rows": len(local_rows)}


# ─────────────────────────── DIAN ───────────────────────────


def _xlsx_shape(path: Path) -> dict:
    try:
        import openpyxl
    except ImportError as exc:  # pragma: no cover - depends on the ml environment
        raise SourceError(
            "openpyxl is missing. Install ml/company_trainer/requirements.txt in ml/company_trainer/.venv."
        ) from exc
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    non_empty = [row for row in rows if any(value not in (None, "") for value in row)]
    max_columns = max((len([v for v in row if v not in (None, "")]) for row in rows), default=0)
    return {
        "sheet": sheet.title,
        "rows": len(non_empty),
        "columns_with_values": max_columns,
    }


def _write_dian_license_note(manifest: dict, evidence_path: Path) -> None:
    files = "\n".join(
        f"| `{item['file_name']}` | `{item['sha256']}` | {item['bytes']} |"
        for item in manifest["version"]["files"]
    )
    content = f"""# DIAN: license status and terms of use

**Review date:** {manifest['generated_at']}
**Source:** {manifest['source']['source_url']}
**Status:** license uncertainty (not verified at the source)

## What was observed

The DIAN collection statistics page does not declare, in the HTML
consulted, an explicit reuse license. The files are published
as public information and the sheets include the note "El contenido de este
documento corresponde a información pública" ("the content of this document is public
information"), but that note alone is not a redistribution license.

## Operational decision (not a legal conclusion)

- The raw files are **not published or committed to git**.
- They are not redistributed outside the local repository.
- They are used only as aggregated context, with attribution to the DIAN.
- No legal prohibition is claimed: only that the license is not
  verified and that explicit permission to redistribute is missing.
- Before publishing derived or raw files, review the source or ask the
  DIAN for permission.

## File evidence (local originals, outside git)

| File | SHA-256 | Bytes |
|---|---|---|
{files}

## Figures and units

- Millions of current pesos.
- Declared cutoff: {manifest['version']['cutoff_date']}.
- 2026 is partial and preliminary; it is not compared as a full year.
"""
    ensure_dir(evidence_path.parent)
    evidence_path.write_text(content, encoding="utf-8", newline="\n")


def acquire_dian(args) -> dict:
    raw_dir = Path(args.raw_dir) if args.raw_dir else RAW_DIR / "dian"
    files = []
    for item in DIAN_FILES:
        path = require_file(
            raw_dir / item["name"],
            hint="Keep the downloaded original; this script does not download it again.",
        )
        evidence = file_evidence(path)
        evidence.update({"kind": item["kind"], "source_url": item["url"]})
        evidence.update(_xlsx_shape(path))
        files.append(evidence)

    cutoff = args.cutoff_date or "2026-10-23"
    period_start = args.period_start or "1970-01-01"
    period_end = args.period_end or "2026-09-30"
    acquired_dt = (
        parse_iso(args.acquired_at)
        if args.acquired_at
        else max(
            datetime.fromtimestamp((REPO_ROOT / f["path"]).stat().st_mtime, tz=timezone.utc)
            for f in files
        )
    )
    acquired_at = iso_z(acquired_dt)
    label = args.version_label or version_label(acquired_dt)

    manifest = {
        "manifest_version": 1,
        "generated_at": iso_z(utcnow()),
        "source": {
            "code": DIAN_CODE,
            "name": "DIAN collection statistics",
            "publisher": "Dirección de Impuestos y Aduanas Nacionales (DIAN)",
            "dataset_id": None,
            "source_url": DIAN_PAGE_URL,
            "metadata_url": None,
            "attribution": "DIAN — Subdirección de Estudios Económicos",
            "attribution_url": DIAN_PAGE_URL,
            "license": {
                "name": "Not verified at the source",
                "license_id": None,
                "terms_url": None,
                "status": "uncertain",
                "evidence_path": "docs/evidence/dian-license-uncertainty.md",
            },
            "cadence": (
                "Monthly/irregular: the DIAN publishes figures with a monthly cutoff; "
                "regional offices can appear days after the national figures."
            ),
            "description": (
                "Gross collection by tax type and by regional office. "
                "It does not represent the tax obligation of an individual company."
            ),
        },
        "version": {
            "version_label": label,
            "identity_sha256": sha256_text("\n".join(sorted(item["sha256"] for item in files))),
            "acquired_at": acquired_at,
            "cutoff_date": cutoff,
            "period_start": period_start,
            "period_end": period_end,
            "is_partial": True,
            "is_preliminary": True,
            "status": "succeeded",
            "source_updated_at": args.source_updated_at or "2026-10-30",
            "row_count": sum(item["rows"] for item in files),
            "column_count": None,
            "files": files,
            "integrity": {
                "method": "sha256 of the originals + sheet structure",
                "files_present": len(files),
                "all_hashes_recorded": all(bool(item["sha256"]) for item in files),
            },
            "processed": [],
            "notes": [
                "Units: millions of current pesos.",
                "2026 is partial (up to September) and preliminary.",
                "It is not joined by NIT or used to label non-compliance.",
                "The raw files are not redistributed while the license stays unverified.",
            ],
        },
    }
    target = manifest_path(DIAN_CODE, label)
    write_json(target, manifest)
    note_path = EVIDENCE_DIR / "dian-license-uncertainty.md"
    _write_dian_license_note(manifest, note_path)
    return {"manifest": relative_to_repo(target), "files": len(files), "rows": manifest["version"]["row_count"]}


# ─────────────────────────── CLI ───────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sup = sub.add_parser("supersociedades", help="Verify or download Supersociedades")
    sup.add_argument("--download", action="store_true", help="Download a new versioned copy")
    sup.add_argument("--page-size", type=int, default=5000)
    sup.add_argument("--raw", help="Path of the local CSV to verify")
    sup.add_argument("--version-label", help="Version label (default: acquisition date)")
    sup.set_defaults(func=acquire_supersociedades)

    dian = sub.add_parser("dian", help="Record the DIAN originals and their license uncertainty")
    dian.add_argument("--raw-dir")
    dian.add_argument("--version-label")
    dian.add_argument("--cutoff-date")
    dian.add_argument("--period-start")
    dian.add_argument("--period-end")
    dian.add_argument("--acquired-at")
    dian.add_argument("--source-updated-at")
    dian.set_defaults(func=acquire_dian)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = args.func(args)
    except SourceError as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 2
    print(json.dumps({"status": "ok", **result}, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

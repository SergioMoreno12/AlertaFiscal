"""Adquisición y verificación de fuentes externas.

Uso (desde la raíz del repositorio):

    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.acquire supersociedades
    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.acquire supersociedades --download
    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.acquire dian

El comando ``supersociedades`` no vuelve a descargar por defecto: verifica el
archivo local contra el conteo y la paginación de Socrata. ``--download``
descarga una copia nueva en una carpeta versionada y nunca sobrescribe una
descarga anterior.
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
        raise SourceError(f"Descarga incompleta: {written} filas de {total} esperadas")
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
        "method": "count + paginación estable",
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
        raise SourceError(f"La paginación devolvió {len(remote_keys)} filas; el conteo declara {total}")
    if duplicate_keys:
        raise SourceError(f"La paginación devolvió {duplicate_keys} claves duplicadas")
    if len(local_rows) != total:
        raise SourceError(
            f"El archivo local tiene {len(local_rows)} filas; Socrata declara {total}. "
            "Posible truncamiento de la descarga original."
        )
    if local_hashes != remote_hashes:
        raise SourceError(
            "Las claves locales no coinciden con la paginación remota. "
            "La fuente pudo actualizarse después de la descarga; conserva el original y documenta el cambio."
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
        "conclusion": "CC BY-SA 4.0 (Creative Commons Atribución-CompartirIgual 4.0 Internacional)",
        "caveats": [
            "El campo license.logoUrl apunta a un archivo llamado cc30bysa.png; "
            "se prioriza licenseId=CC_40_BY_SA y termsLink=by-sa/4.0/legalcode.",
            "La atribución debe conservarse y las adaptaciones deben compartirse bajo la misma licencia.",
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
        raise SourceError("No se pudieron determinar los años del dataset")
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
                "Irregular: el publicador actualiza el dataset sin calendario fijo. "
                "No se debe asumir una frecuencia mensual."
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
                "Cifras publicadas en billones de pesos (10^12 COP), no en miles de millones.",
                "El dataset cubre las 10.000 empresas más grandes; no es representativo del universo empresarial.",
                "Los datos se usan solo como contexto agregado; no se unen por NIT con el ERP.",
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
    except ImportError as exc:  # pragma: no cover - depende del entorno ml
        raise SourceError(
            "Falta openpyxl en el entorno. Instala ml/company_trainer/requirements.txt en ml/company_trainer/.venv."
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
    content = f"""# DIAN: estado de licencia y condiciones de uso

**Fecha de revisión:** {manifest['generated_at']}
**Fuente:** {manifest['source']['source_url']}
**Estado:** incertidumbre de licencia (no verificada en la fuente)

## Qué se observó

La página de estadísticas de recaudo de la DIAN no declara, en el HTML
consultado, una licencia de reutilización explícita. Los archivos se publican
como información pública y las hojas incluyen la leyenda "El contenido de este
documento corresponde a información pública", pero esa leyenda no equivale por
sí sola a una licencia de redistribución.

## Decisión operativa (no es una conclusión legal)

- Los archivos crudos **no se publican ni se versionan en git**.
- No se redistribuyen fuera del repositorio local.
- Se usan únicamente como contexto agregado, con atribución a la DIAN.
- No se afirma que exista una prohibición legal: solo que la licencia no está
  verificada y que falta autorización explícita para redistribuir.
- Antes de publicar derivados o crudos, se debe revisar la fuente o pedir
  autorización a la DIAN.

## Evidencia de archivos (originales locales, fuera de git)

| Archivo | SHA-256 | Bytes |
|---|---|---|
{files}

## Cifras y unidades

- Millones de pesos corrientes.
- Corte declarado: {manifest['version']['cutoff_date']}.
- 2026 es parcial y preliminar; no se compara como año completo.
"""
    ensure_dir(evidence_path.parent)
    evidence_path.write_text(content, encoding="utf-8", newline="\n")


def acquire_dian(args) -> dict:
    raw_dir = Path(args.raw_dir) if args.raw_dir else RAW_DIR / "dian"
    files = []
    for item in DIAN_FILES:
        path = require_file(
            raw_dir / item["name"],
            hint="Conserva el original descargado; este script no lo vuelve a descargar.",
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
            "name": "Estadísticas de recaudo de la DIAN",
            "publisher": "Dirección de Impuestos y Aduanas Nacionales (DIAN)",
            "dataset_id": None,
            "source_url": DIAN_PAGE_URL,
            "metadata_url": None,
            "attribution": "DIAN — Subdirección de Estudios Económicos",
            "attribution_url": DIAN_PAGE_URL,
            "license": {
                "name": "No verificada en la fuente",
                "license_id": None,
                "terms_url": None,
                "status": "uncertain",
                "evidence_path": "docs/evidence/dian-license-uncertainty.md",
            },
            "cadence": (
                "Mensual/irregular: la DIAN publica cifras con corte mensual; "
                "las seccionales pueden aparecer días después que las nacionales."
            ),
            "description": (
                "Recaudo bruto por tipo de impuesto y por dirección seccional. "
                "No representa la obligación tributaria de una empresa individual."
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
                "method": "sha256 de originales + estructura de hojas",
                "files_present": len(files),
                "all_hashes_recorded": all(bool(item["sha256"]) for item in files),
            },
            "processed": [],
            "notes": [
                "Unidades: millones de pesos corrientes.",
                "2026 es parcial (a septiembre) y preliminar.",
                "No se une por NIT ni se usa para etiquetar incumplimiento.",
                "No se redistribuyen los crudos mientras la licencia siga sin verificar.",
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

    sup = sub.add_parser("supersociedades", help="Verifica o descarga Supersociedades")
    sup.add_argument("--download", action="store_true", help="Descarga una copia nueva versionada")
    sup.add_argument("--page-size", type=int, default=5000)
    sup.add_argument("--raw", help="Ruta del CSV local a verificar")
    sup.add_argument("--version-label", help="Etiqueta de versión (por defecto, fecha de adquisición)")
    sup.set_defaults(func=acquire_supersociedades)

    dian = sub.add_parser("dian", help="Registra los originales DIAN y su incertidumbre de licencia")
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

"""Procesamiento reproducible de los originales a tablas de contexto.

Uso (desde la raíz del repositorio):

    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.build_context supersociedades
    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.build_context dian
    ml/company_trainer/.venv/Scripts/python.exe -m ml.company_trainer.sources.build_context all

No descarga datos. Lee el manifiesto de adquisición, procesa los originales
locales y escribe CSV derivados en ``ml/data/processed`` (fuera de git),
actualizando el manifiesto versionado con hashes y conteos.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .common import (
    BILLONES,
    COP_QUANTUM,
    MANIFEST_DIR,
    PROCESSED_DIR,
    REPO_ROOT,
    SourceError,
    billones_to_cop,
    decimal_str,
    ensure_dir,
    file_evidence,
    iso_z,
    load_manifest,
    millones_to_cop,
    normalize_series_code,
    parse_month_es,
    parse_supersociedades_amount,
    parse_year,
    quantile,
    read_csv_rows,
    relative_to_repo,
    require_file,
    utcnow,
    write_csv,
    write_json,
)

SUPERSOCIEDADES_CODE = "supersociedades_top10000"
DIAN_CODE = "dian_recaudo"

SUPERSOCIEDADES_METRICS = [
    ("ingresos_operacionales", "Ingresos operacionales"),
    ("ganancia_p_rdida", "Ganancia o pérdida"),
    ("total_activos", "Total activos"),
    ("total_pasivos", "Total pasivos"),
    ("total_patrimonio", "Total patrimonio"),
]

ANNUAL_CODES = [
    "actividad_interna",
    "renta",
    "renta_cuotas",
    "retencion_renta",
    "iva",
    "declaraciones_iva",
    "retencion_iva",
    "timbre",
    "gmf",
    "patrimonio",
    "riqueza",
    "impuesto_consumo",
    "gasolina_acpm",
    "carbono",
    "cree",
    "declaraciones_cree",
    "retencion_cree",
    "rst_simple",
    "normalizacion_tributaria",
    "consumo_bienes_inmuebles",
    "plasticos",
    "bebidas_azucaradas",
    "comestibles_ultraprocesados",
    "catatumbo",
    "actividad_externa",
    "iva_externo",
    "arancel",
    "por_clasificar",
    "total_dian",
]

MONTHLY_CODES = [
    "internos",
    "renta",
    "renta_cuotas",
    "retencion_renta",
    "iva_interno",
    "declaraciones_iva",
    "retencion_iva",
    "gmf",
    "timbre",
    "seguridad_democratica",
    "patrimonio",
    "riqueza",
    "consumo",
    "gasolina_acpm",
    "carbono",
    "cree",
    "cree_declaraciones",
    "cree_retencion",
    "rst_simple",
    "normalizacion",
    "consumo_bienes",
    "plasticos",
    "bebidas_azucaradas",
    "comestibles",
    "catatumbo",
    "externos",
    "arancel",
    "iva_externo",
    "por_clasificar",
    "total",
]

DEPARTMENT_CODES = [
    "renta_cuotas",
    "iva_declaraciones",
    "retenciones",
    "externos",
    "seguridad_democratica",
    "patrimonio",
    "riqueza",
    "precios_transferencia",
    "gmf",
    "consumo",
    "gasolina_acpm",
    "cree_retenciones",
    "cree_declaraciones",
    "carbono",
    "simple",
    "normalizacion",
    "consumo_bienes",
    "iva_exterior",
    "plasticos",
    "bebidas",
    "comestibles",
    "catatumbo",
    "por_clasificar",
    "total",
]

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


def latest_manifest(source_code: str) -> Path:
    directory = MANIFEST_DIR / source_code
    candidates = sorted(directory.glob("*.json"), key=lambda item: item.stem)
    if not candidates:
        raise SourceError(
            f"No hay manifiestos para {source_code} en {directory}. "
            "Ejecuta primero ml.company_trainer.sources.acquire."
        )
    return candidates[-1]


def _resolve_manifest(source_code: str, explicit: str | None) -> Path:
    if explicit:
        return require_file(Path(explicit))
    return latest_manifest(source_code)


def _update_processed(manifest_path: Path, manifest: dict, entries: list[dict]) -> None:
    processed = [item for item in manifest["version"].get("processed", []) if item.get("table") not in {e["table"] for e in entries}]
    processed.extend(entries)
    manifest["version"]["processed"] = processed
    manifest["version"]["processed_at"] = iso_z(utcnow())
    write_json(manifest_path, manifest)


# ─────────────────────────── Supersociedades ───────────────────────────


def _clean_label(label: str) -> str:
    text = re.sub(r"\s*/\s*\d+\s*$", "", str(label or "").strip())
    return re.sub(r"\s+", " ", text).strip()


def build_supersociedades(manifest_path: Path) -> dict:
    manifest = load_manifest(manifest_path)
    raw_path = require_file(REPO_ROOT / manifest["version"]["file"]["path"])
    label = manifest["version"]["version_label"]
    out_dir = PROCESSED_DIR / SUPERSOCIEDADES_CODE / label
    ensure_dir(out_dir)

    values: dict[tuple[int, str, str], list[Decimal]] = defaultdict(list)
    companies: set[str] = set()
    years: set[int] = set()
    sectors: set[str] = set()
    duplicate_pairs = 0
    seen_pairs: set[tuple[str, int]] = set()
    identity_max = Decimal("0")
    identity_over_tolerance = 0
    rows = 0

    for row in read_csv_rows(raw_path):
        rows += 1
        year = parse_year(row.get("a_o_de_corte"))
        if year is None:
            continue
        nit = str(row.get("nit") or "").strip()
        sector = (row.get("macrosector") or "SIN_MACROSECTOR").strip() or "SIN_MACROSECTOR"
        companies.add(nit)
        years.add(year)
        sectors.add(sector)
        pair = (nit, year)
        if pair in seen_pairs:
            duplicate_pairs += 1
        seen_pairs.add(pair)

        parsed = {
            column: parse_supersociedades_amount(row.get(column))
            for column, _label in SUPERSOCIEDADES_METRICS
        }
        for column, _label in SUPERSOCIEDADES_METRICS:
            value = parsed[column]
            if value is None:
                continue
            values[(year, column, "ALL")].append(value)
            values[(year, column, sector)].append(value)

        assets, liabilities, equity = (
            parsed["total_activos"],
            parsed["total_pasivos"],
            parsed["total_patrimonio"],
        )
        if None not in (assets, liabilities, equity):
            residual = abs(assets - liabilities - equity)
            identity_max = max(identity_max, residual)
            if residual > Decimal("0.01"):
                identity_over_tolerance += 1

    output_rows = []
    for (year, metric, sector), items in sorted(values.items()):
        items.sort()
        count = len(items)
        total = sum(items, Decimal("0"))
        mean = total / count
        label_metric = dict(SUPERSOCIEDADES_METRICS)[metric]
        output_rows.append(
            {
                "year": year,
                "metric": metric,
                "metric_label": label_metric,
                "sector": sector,
                "sample_size": count,
                "total_cop": decimal_str(billones_to_cop(total)),
                "mean_cop": decimal_str(billones_to_cop(mean)),
                "median_cop": decimal_str(billones_to_cop(quantile(items, Decimal("0.5")))),
                "p25_cop": decimal_str(billones_to_cop(quantile(items, Decimal("0.25")))),
                "p75_cop": decimal_str(billones_to_cop(quantile(items, Decimal("0.75")))),
                "min_cop": decimal_str(billones_to_cop(items[0])),
                "max_cop": decimal_str(billones_to_cop(items[-1])),
                "zero_count": sum(1 for item in items if item == 0),
                "negative_count": sum(1 for item in items if item < 0),
            }
        )

    csv_path = out_dir / "sector_benchmarks.csv"
    write_csv(csv_path, BENCHMARK_FIELDS, output_rows)
    quality = {
        "source_code": SUPERSOCIEDADES_CODE,
        "version_label": label,
        "raw_path": relative_to_repo(raw_path),
        "raw_sha256": manifest["version"]["file"]["sha256"],
        "rows_read": rows,
        "companies": len(companies),
        "years": sorted(years),
        "sectors": sorted(sectors),
        "duplicate_company_year_pairs": duplicate_pairs,
        "identity": {
            "formula": "total_activos - total_pasivos - total_patrimonio",
            "unit": "billones COP",
            "max_abs_residual": str(identity_max),
            "rows_over_0_01": identity_over_tolerance,
        },
        "benchmark_rows": len(output_rows),
        "units": "COP (los originales están en billones de 10^12 COP)",
        "limitations": [
            "Muestra de las 10.000 empresas más grandes; sesgo de selección.",
            "No es un censo ni un promedio del universo empresarial colombiano.",
            "Los agregados por macrosector no se unen por NIT con el ERP.",
        ],
    }
    quality_path = out_dir / "quality.json"
    write_json(quality_path, quality)

    entries = [
        {
            "table": "sector_benchmarks",
            **file_evidence(csv_path),
            "rows": len(output_rows),
        },
        {"table": "quality", **file_evidence(quality_path)},
    ]
    _update_processed(manifest_path, manifest, entries)
    return {"manifest": relative_to_repo(manifest_path), "output": relative_to_repo(csv_path), **quality}


# ─────────────────────────── DIAN ───────────────────────────


def _to_decimal(value) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    text = str(value).strip().replace("\u00a0", "").replace(" ", "")
    if text in {"", "-", "--", "nan", "None"}:
        return None
    text = text.replace(",", "")
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _is_total_department_row(name: str) -> bool:
    """Detecta la fila de total anual de la hoja seccional.

    La fuente escribe habitualmente ``TOTAL AÑO 2026``, pero en la publicación
    de 2026 aparece ``TOTA  AÑO 2026`` (sin la L y con doble espacio). Si esa
    fila se trata como una seccional, el total departamental se duplica.
    """
    normalized = unicodedata.normalize("NFKD", name)
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"[^A-Z0-9]+", " ", normalized.upper()).strip()
    return re.fullmatch(r"TOT[A-Z]* ANO( \d{4})?", normalized) is not None


def _labels(row: tuple, codes: list[str], fallback_row: tuple | None = None) -> list[tuple[int, str, str]]:
    result = []
    for index, code in enumerate(codes, start=1 if len(codes) == 29 else 2):
        label = row[index] if index < len(row) else None
        if (label is None or str(label).strip() == "") and fallback_row is not None and index < len(fallback_row):
            label = fallback_row[index]
        result.append((index, code, _clean_label(label) or code))
    return result


def _read_sheet(path: Path) -> list[tuple]:
    try:
        import openpyxl
    except ImportError as exc:  # pragma: no cover - depende del entorno ml
        raise SourceError(
            "Falta openpyxl en el entorno. Instala ml/company_trainer/requirements.txt en ml/company_trainer/.venv."
        ) from exc
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    return list(workbook.active.iter_rows(values_only=True))


def _tax_row(scope, frequency, year, month, department, code, label, value, preliminary):
    return {
        "scope": scope,
        "frequency": frequency,
        "period_year": year,
        "period_month": month or "",
        "department_name": department or "",
        "series_code": code,
        "series_label": label,
        "value_cop": decimal_str(millones_to_cop(value)),
        "is_preliminary": "true" if preliminary else "false",
    }


def build_dian(manifest_path: Path) -> dict:
    manifest = load_manifest(manifest_path)
    label = manifest["version"]["version_label"]
    out_dir = PROCESSED_DIR / DIAN_CODE / label
    ensure_dir(out_dir)

    files = {item["kind"]: item for item in manifest["version"]["files"]}
    rows: list[dict] = []
    quality: dict = {"source_code": DIAN_CODE, "version_label": label, "files": {}}
    annual_totals: dict[int, Decimal] = {}
    monthly_totals: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    monthly_months: dict[int, set[int]] = defaultdict(set)
    department_totals: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))

    # Anual: encabezado en la fila 10 (índice 9), datos desde la fila 11 (índice 10).
    annual_path = require_file(REPO_ROOT / files["annual"]["path"])
    annual_rows = _read_sheet(annual_path)
    header = annual_rows[9]
    group_header = annual_rows[8]
    year_count = 0
    for row in annual_rows[10:]:
        year = parse_year(row[0]) if row else None
        if year is None:
            continue
        year_count += 1
        preliminary = year >= 2026
        for index, code, series_label in _labels(header, ANNUAL_CODES, group_header):
            value = _to_decimal(row[index] if index < len(row) else None)
            if value is None:
                continue
            rows.append(_tax_row("national", "annual", year, None, None, code, series_label, value, preliminary))
            if code == "total_dian":
                annual_totals[year] = millones_to_cop(value) or Decimal("0")
    quality["files"]["annual"] = {"path": relative_to_repo(annual_path), "years": year_count, "header_row": 10}

    # Mensual: encabezado en la fila 9 (índice 8), datos desde la fila 10 (índice 9).
    monthly_path = require_file(REPO_ROOT / files["monthly"]["path"])
    monthly_rows = _read_sheet(monthly_path)
    monthly_header = monthly_rows[8]
    month_count = 0
    for row in monthly_rows[9:]:
        year = parse_year(row[0]) if row else None
        month = parse_month_es(row[1]) if row and len(row) > 1 else None
        if year is None or month is None:
            continue
        month_count += 1
        preliminary = year >= 2026
        monthly_months[year].add(month)
        for index, code, series_label in _labels(monthly_header, MONTHLY_CODES):
            value = _to_decimal(row[index] if index < len(row) else None)
            if value is None:
                continue
            rows.append(
                _tax_row("national", "monthly", year, month, None, code, series_label, value, preliminary)
            )
            if code == "total":
                monthly_totals[year] += millones_to_cop(value) or Decimal("0")
    quality["files"]["monthly"] = {"path": relative_to_repo(monthly_path), "months": month_count, "header_row": 9}

    # Seccional: encabezado en la fila 6 (índice 5), datos desde la fila 8 (índice 7).
    department_path = require_file(REPO_ROOT / files["department"]["path"])
    department_rows = _read_sheet(department_path)
    department_header = department_rows[5]
    current_year: int | None = None
    department_count = 0
    excluded_total_rows = 0
    for row in department_rows[7:]:
        if not row:
            continue
        year = parse_year(row[0])
        if year is not None:
            current_year = year
        if current_year is None:
            continue
        department = str(row[1] or "").strip() if len(row) > 1 else ""
        if not department:
            continue
        # La hoja incluye una fila de total anual por año; no es una seccional
        # y sumarla duplicaría el recaudo. La fuente tiene variantes como
        # "TOTAL AÑO 2026" y "TOTA  AÑO 2026".
        if _is_total_department_row(department):
            excluded_total_rows += 1
            continue
        department_count += 1
        preliminary = current_year >= 2026
        for index, code, series_label in _labels(department_header, DEPARTMENT_CODES):
            value = _to_decimal(row[index] if index < len(row) else None)
            if value is None:
                continue
            rows.append(
                _tax_row(
                    "department",
                    "annual",
                    current_year,
                    None,
                    department,
                    code,
                    series_label,
                    value,
                    preliminary,
                )
            )
            if code == "total":
                department_totals[current_year] += millones_to_cop(value) or Decimal("0")
    quality["files"]["department"] = {
        "path": relative_to_repo(department_path),
        "rows": department_count,
        "excluded_total_rows": excluded_total_rows,
        "header_row": 6,
    }

    csv_path = out_dir / "tax_collection.csv"
    write_csv(csv_path, TAX_FIELDS, rows)

    # Conciliación mensual-anual 2010-2025 (años completos en ambas series).
    reconciliation = []
    max_diff = Decimal("0")
    for year in range(2010, 2026):
        if year not in annual_totals or year not in monthly_totals:
            continue
        diff = abs(annual_totals[year] - monthly_totals[year])
        max_diff = max(max_diff, diff)
        reconciliation.append(
            {
                "year": year,
                "annual_total_cop": decimal_str(annual_totals[year]),
                "monthly_sum_cop": decimal_str(monthly_totals[year]),
                "abs_diff_cop": decimal_str(diff),
                "months": len(monthly_months.get(year, set())),
            }
        )

    quality.update(
        {
            "rows_written": len(rows),
            "years": sorted({row["period_year"] for row in rows}),
            "scopes": sorted({row["scope"] for row in rows}),
            "frequencies": sorted({row["frequency"] for row in rows}),
            "units": "COP (originales en millones de pesos corrientes)",
            "reconciliation_monthly_annual": {
                "range": "2010-2025",
                "max_abs_diff_cop": decimal_str(max_diff),
                "rows": reconciliation,
            },
            "reconciliation_department_national": {
                "year": 2025,
                "national_total_cop": decimal_str(annual_totals.get(2025, Decimal("0"))),
                "department_sum_cop": decimal_str(department_totals.get(2025, Decimal("0"))),
                "abs_diff_cop": decimal_str(
                    abs(annual_totals.get(2025, Decimal("0")) - department_totals.get(2025, Decimal("0")))
                ),
            },
            "reconciliation_department_national_2026": {
                "year": 2026,
                "national_total_cop": decimal_str(annual_totals.get(2026, Decimal("0"))),
                "department_sum_cop": decimal_str(department_totals.get(2026, Decimal("0"))),
                "abs_diff_cop": decimal_str(
                    abs(annual_totals.get(2026, Decimal("0")) - department_totals.get(2026, Decimal("0")))
                ),
                "note": "2026 es parcial y preliminar; la comparación verifica que no se duplique la fila de total.",
            },
            "limitations": [
                "El recaudo agregado no es la obligación tributaria de una empresa individual.",
                "2026 es parcial (a septiembre) y preliminar.",
                "Las cifras se publican en millones de pesos corrientes; no se deflactan.",
                "No se une por NIT con el ERP ni se usa para etiquetar incumplimiento.",
            ],
        }
    )
    quality_path = out_dir / "quality.json"
    write_json(quality_path, quality)

    entries = [
        {"table": "tax_collections", **file_evidence(csv_path), "rows": len(rows)},
        {"table": "quality", **file_evidence(quality_path)},
    ]
    _update_processed(manifest_path, manifest, entries)
    return {"manifest": relative_to_repo(manifest_path), "output": relative_to_repo(csv_path), **quality}


# ─────────────────────────── CLI ───────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=["supersociedades", "dian", "all"])
    parser.add_argument("--manifest", help="Ruta explícita del manifiesto de adquisición")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    results = {}
    try:
        if args.target in ("supersociedades", "all"):
            results["supersociedades"] = build_supersociedades(
                _resolve_manifest(SUPERSOCIEDADES_CODE, args.manifest if args.target == "supersociedades" else None)
            )
        if args.target in ("dian", "all"):
            results["dian"] = build_dian(
                _resolve_manifest(DIAN_CODE, args.manifest if args.target == "dian" else None)
            )
    except SourceError as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 2
    print(json.dumps({"status": "ok", **results}, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

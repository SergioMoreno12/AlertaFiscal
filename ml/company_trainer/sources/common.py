"""Helpers shared by the external source scripts.

They only use the standard library. Network acquisition happens only
when ``acquire.py`` is called explicitly; the rest of the pipeline is
offline and deterministic.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# This file lives in ml/company_trainer/sources/, so the repository root is three levels up.
REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = REPO_ROOT / "ml" / "data" / "raw"
PROCESSED_DIR = REPO_ROOT / "ml" / "data" / "processed"
MANIFEST_DIR = Path(__file__).resolve().parent / "manifests"
EVIDENCE_DIR = REPO_ROOT / "docs" / "erp" / "evidence"

SOCRATA_DOMAIN = "https://www.datos.gov.co"
SUPERSOCIEDADES_ID = "6cat-2gcs"
SUPERSOCIEDADES_METADATA_URL = f"{SOCRATA_DOMAIN}/api/views/{SUPERSOCIEDADES_ID}.json"
SUPERSOCIEDADES_RESOURCE_URL = f"{SOCRATA_DOMAIN}/resource/{SUPERSOCIEDADES_ID}.csv"
SUPERSOCIEDADES_KEYS_URL = f"{SOCRATA_DOMAIN}/resource/{SUPERSOCIEDADES_ID}.json"

DIAN_PAGE_URL = "https://www.dian.gov.co/dian/cifras/Paginas/EstadisticasRecaudo.aspx"
DIAN_BASE_URL = "https://www.dian.gov.co/dian/cifras/EstadisticasRecaudo"

USER_AGENT = "AlertaFiscal-source-acquisition/1.0 (proyecto academico; contacto local)"

COP_QUANTUM = Decimal("0.01")
BILLONES = Decimal("1000000000000")  # 10^12: "billones" in the Spanish sense (trillions).
MILLONES = Decimal("1000000")

MONTHS_ES = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}


class SourceError(RuntimeError):
    """Controlled error while acquiring or processing a source."""


# ─────────────────────────── Time and files ───────────────────────────


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(raw: str) -> datetime:
    text = str(raw).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    value = datetime.fromisoformat(text)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def version_label(value: datetime | None = None) -> str:
    """Safe label for a file name: 2026-10-30T214803Z."""
    return iso_z(value or utcnow()).replace("-", "").replace(":", "")


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def write_json(path: Path, data) -> None:
    ensure_dir(path.parent)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=False)
        handle.write("\n")
    os.replace(tmp, path)


def read_json(path: Path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def write_csv(path: Path, fieldnames: list[str], rows) -> int:
    ensure_dir(path.parent)
    tmp = path.with_suffix(path.suffix + ".tmp")
    count = 0
    with open(tmp, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="raise")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
            count += 1
    os.replace(tmp, path)
    return count


def read_csv_rows(path: Path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def require_file(path: Path, hint: str = "") -> Path:
    if not path.exists():
        message = f"The required file does not exist: {path}"
        if hint:
            message += f". {hint}"
        raise SourceError(message)
    return path


def relative_to_repo(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT)).replace("\\", "/")
    except ValueError:
        return str(path.resolve())


def file_evidence(path: Path) -> dict:
    require_file(path)
    return {
        "path": relative_to_repo(path),
        "file_name": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def manifest_path(source_code: str, label: str) -> Path:
    return MANIFEST_DIR / source_code / f"{label}.json"


def load_manifest(path: Path) -> dict:
    data = read_json(require_file(path))
    if not isinstance(data, dict) or "source" not in data or "version" not in data:
        raise SourceError(f"Invalid manifest ('source' or 'version' is missing): {path}")
    return data


# ─────────────────────────── Red ───────────────────────────


def http_get_bytes(url: str, *, timeout: int = 90, retries: int = 3) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
    raise SourceError(f"Could not download {url}: {last_error}")


def http_get_json(url: str, *, timeout: int = 90, retries: int = 3):
    payload = http_get_bytes(url, timeout=timeout, retries=retries)
    try:
        return json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - non-JSON response
        raise SourceError(f"Non-JSON response from {url}: {exc}") from exc


class SocrataClient:
    """Minimal client for a Socrata dataset (datos.gov.co)."""

    def __init__(self, dataset_id: str, domain: str = SOCRATA_DOMAIN):
        self.dataset_id = dataset_id
        self.domain = domain.rstrip("/")

    def metadata(self) -> dict:
        return http_get_json(f"{self.domain}/api/views/{self.dataset_id}.json")

    def count(self) -> int:
        url = f"{self.domain}/resource/{self.dataset_id}.json?" + urlencode({"$select": "count(*)"})
        payload = http_get_json(url)
        if not payload or "count" not in payload[0]:
            raise SourceError(f"Unexpected Socrata count: {payload!r}")
        return int(payload[0]["count"])

    def select(
        self,
        columns: str,
        *,
        order: str,
        limit: int,
        offset: int,
        fmt: str = "json",
    ):
        params = {
            "$select": columns,
            "$order": order,
            "$limit": str(limit),
            "$offset": str(offset),
        }
        url = f"{self.domain}/resource/{self.dataset_id}.{fmt}?" + urlencode(params)
        if fmt == "json":
            return http_get_json(url)
        return http_get_bytes(url)


# ─────────────────────────── Numeric parsing ───────────────────────────


def parse_supersociedades_amount(raw) -> Decimal | None:
    """Convierte ``"$ 100.59"`` / ``"-$ 0.82"`` a Decimal en billones.

    The dataset publishes the figures in trillions (10^12 COP) with two decimals.
    No precision is made up: the result keeps exactly what was published.
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text.lower() in {"nan", "none", "n/a", "null", "-"}:
        return None
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1]
    text = text.replace("$", "").replace("\u00a0", "").replace(" ", "")
    if text.startswith("-"):
        negative = True
        text = text[1:]
    text = text.replace(",", "")
    if not text:
        return None
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise SourceError(f"Importe no reconocido: {raw!r}") from exc
    return -value if negative else value


def billones_to_cop(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    return (value * BILLONES).quantize(COP_QUANTUM)


def millones_to_cop(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return (Decimal(str(value)) * MILLONES).quantize(COP_QUANTUM)
    except InvalidOperation as exc:
        raise SourceError(f"Importe DIAN no reconocido: {value!r}") from exc


def parse_year(raw) -> int | None:
    if raw is None or raw == "":
        return None
    text = str(raw).strip()
    match = re.match(r"(\d{4})", text)
    if match:
        return int(match.group(1))
    try:
        return int(Decimal(text))
    except InvalidOperation:
        return None


def parse_month_es(raw) -> int | None:
    if raw is None or raw == "":
        return None
    text = _strip_accents(str(raw)).strip().lower()
    if text in MONTHS_ES:
        return MONTHS_ES[text]
    if text.isdigit() and 1 <= int(text) <= 12:
        return int(text)
    return None


def _strip_accents(text: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char)
    )


def normalize_series_code(label: str) -> str:
    text = _strip_accents(str(label or "")).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"/\s*\d+", " ", text)
    text = re.sub(r"\*+", " ", text)
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_") or "serie"


def decimal_str(value: Decimal | None) -> str:
    if value is None:
        return ""
    return f"{value:.2f}"


# ─────────────────────────── Cuantiles ───────────────────────────


def quantile(sorted_values: list[Decimal], q: Decimal) -> Decimal | None:
    """Quantile with linear interpolation over an already sorted list."""
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = q * Decimal(len(sorted_values) - 1)
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = position - Decimal(lower)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction

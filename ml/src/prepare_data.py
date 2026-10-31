"""
Phase 2 - Step 2: clean the raw data and compute the real statistics used by the generator.

Inputs (ml/data/raw/, never edited by hand):
    supersociedades_10000_companies.csv   datos.gov.co dataset 6cat-2gcs (CSV export)
    dian_monthly_collection_2000_2026.xlsx DIAN monthly collection by type of tax

Outputs (ml/data/processed/):
    sector_profiles.csv  margin and growth per sector
    seasonality.csv      12 seasonality factors that average 1.0
    companies_base.csv   real records eligible for `derived` companies

Run from the repository root:
    python ml/src/prepare_data.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "ml" / "data" / "raw"
PROCESSED_DIR = ROOT / "ml" / "data" / "processed"

SUPERSOC_FILE = RAW_DIR / "supersociedades_10000_companies.csv"
DIAN_FILE = RAW_DIR / "dian_monthly_collection_2000_2026.xlsx"

# Supersociedades reports amounts in trillions of COP (Spanish "billones") with two decimals,
# so every value is rounded to steps of 0.01 trillion (COP 10,000 million).
TRILLION_TO_MILLION = 1_000_000

# Values below 0.05 trillion are quantized: only 5 possible steps, many companies look identical.
QUANTIZED_BELOW = 0.05
# Margins and growth are only computed from records whose income is at least 0.5 trillion.
# There, the rounding of profit (+-0.005) moves the margin by at most 1 percentage point.
MIN_PRECISE_INCOME = 0.5

# Plausibility limits. Values outside them are treated as data errors or one-off events
# (mergers, liquidations) and excluded from the sector statistics.
MARGIN_LIMITS = (-0.50, 0.60)
GROWTH_LIMITS = (-0.50, 1.00)

SECTOR_NAMES = {
    "AGROPECUARIO": "agriculture",
    "COMERCIO": "retail",
    "CONSTRUCCION": "construction",
    "MANUFACTURA": "manufacturing",
    "MINERO": "mining",
    "SERVICIOS": "services",
}

MONTHS_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}

# DIAN: years used for seasonality. Complete years only, excluding 2020-2021 (COVID lockdowns
# distort the yearly shape) and 2026 (incomplete).
SEASONALITY_YEARS = [2015, 2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025]
DIAN_HEADER_ROW = 8  # zero-based row of the header ("Año", "Mes", ...)
DIAN_VAT_COLUMN_PREFIX = "2.1. Declaraciones IVA"


def parse_amount(series):
    """Convert texts like '$ 0.03', '$0.03' or '-$ 0.82' to floats (trillions of COP)."""
    clean = (
        series.astype(str)
        .str.replace("$", "", regex=False)
        .str.replace(",", "", regex=False)
        .str.replace(" ", "", regex=False)
    )
    return pd.to_numeric(clean, errors="coerce")


def sector_name(raw):
    """Map the Spanish macrosector to a lowercase English name (ignores accents and bad encoding)."""
    key = str(raw).upper().strip()
    if key.startswith("CONSTRUCC"):
        key = "CONSTRUCCION"
    return SECTOR_NAMES.get(key)


# ---------- Supersociedades ----------
def load_supersociedades():
    raw = pd.read_csv(SUPERSOC_FILE, dtype=str, encoding="utf-8", encoding_errors="replace")
    df = pd.DataFrame({
        "nit": raw["nit"].str.replace(".00", "", regex=False).str.strip(),
        "sector": raw["macrosector"].map(sector_name),
        "year": pd.to_numeric(raw["a_o_de_corte"], errors="coerce").astype("Int64"),
        "income_t": parse_amount(raw["ingresos_operacionales"]),
        "profit_t": parse_amount(raw["ganancia_p_rdida"]),
    })

    n_raw = len(df)
    df = df.dropna(subset=["nit", "sector", "year", "income_t", "profit_t"])
    df = df[df["income_t"] > 0]
    print(f"Supersociedades: {n_raw} raw rows, {len(df)} usable rows "
          f"({n_raw - len(df)} dropped: missing values or zero income)")

    df["quantized"] = df["income_t"] < QUANTIZED_BELOW
    df["precise"] = df["income_t"] >= MIN_PRECISE_INCOME
    df["margin"] = df["profit_t"] / df["income_t"]
    # Expenses are not reported directly: income minus profit.
    df["income_m"] = (df["income_t"] * TRILLION_TO_MILLION).round(2)
    df["expenses_m"] = ((df["income_t"] - df["profit_t"]) * TRILLION_TO_MILLION).round(2)
    print(f"  quantized (< {QUANTIZED_BELOW} trillion): {df['quantized'].mean():.1%} of rows")
    print(f"  precise (>= {MIN_PRECISE_INCOME} trillion): {df['precise'].sum()} rows")
    return df


def compute_growth(df):
    """Real year-over-year income growth per NIT, using only consecutive years of precise records."""
    precise = df[df["precise"]].sort_values(["nit", "year"])
    prev = precise.groupby("nit")[["year", "income_t"]].shift(1)
    consecutive = prev["year"] == precise["year"] - 1
    growth = (precise["income_t"] / prev["income_t"] - 1)[consecutive]
    out = precise.loc[growth.index, ["nit", "sector", "year"]].assign(growth=growth)
    return out


def summarize(values):
    q1, med, q3 = np.percentile(values, [25, 50, 75])
    return med, (q3 - q1) / 1.349  # IQR-based spread, robust to outliers (equals std for a normal)


def build_profiles(df, growth):
    margins = df[df["precise"] & df["margin"].between(*MARGIN_LIMITS)]
    growths = growth[growth["growth"].between(*GROWTH_LIMITS)]
    print(f"  margins kept: {len(margins)} of {df['precise'].sum()} precise rows "
          f"(limits {MARGIN_LIMITS})")
    print(f"  growth kept: {len(growths)} of {len(growth)} YoY pairs (limits {GROWTH_LIMITS})")

    latest_year = df["year"].max()
    weight = df[df["year"] == latest_year]["sector"].value_counts(normalize=True)

    rows = []
    for sector in sorted(SECTOR_NAMES.values()):
        m = margins.loc[margins["sector"] == sector, "margin"]
        g = growths.loc[growths["sector"] == sector, "growth"]
        m_med, m_spread = summarize(m)
        g_med, g_spread = summarize(g)
        rows.append({
            "sector": sector,
            "share": round(weight.get(sector, 0.0), 4),
            "margin_median": round(m_med, 4),
            "margin_spread": round(m_spread, 4),
            "margin_n": len(m),
            "growth_median": round(g_med, 4),
            "growth_spread": round(g_spread, 4),
            "growth_n": len(g),
        })
    return pd.DataFrame(rows), margins, growths


def build_companies_base(df, margins, growths):
    """Real records with both a plausible margin and a plausible growth: one row per NIT (latest year)."""
    last_growth = growths.sort_values("year").groupby("nit").tail(1)[["nit", "year", "growth"]]
    base = margins.merge(last_growth, on=["nit", "year"], how="inner")
    base = base.sort_values(["nit", "year"]).groupby("nit").tail(1)

    # Size rank among these eligible records (0 = smallest, 1 = largest). The generator keeps this
    # rank when it rescales the company to small-business size, so derived companies are not all
    # placed at the top of the small-business range.
    base["size_pct"] = base["income_m"].rank(pct=True)

    base = base[["nit", "sector", "year", "income_m", "expenses_m", "margin", "growth", "size_pct"]]
    base = base.sort_values("nit").reset_index(drop=True)
    for col in ["margin", "growth", "size_pct"]:
        base[col] = base[col].round(4)
    return base


# ---------- DIAN ----------
def load_dian_vat():
    raw = pd.read_excel(DIAN_FILE, sheet_name=0, header=DIAN_HEADER_ROW)
    year_col, month_col = raw.columns[0], raw.columns[1]
    vat_col = next(c for c in raw.columns if str(c).startswith(DIAN_VAT_COLUMN_PREFIX))

    df = pd.DataFrame({
        "year": pd.to_numeric(raw[year_col], errors="coerce"),
        "month": raw[month_col].astype(str).str.strip().str.lower().map(MONTHS_ES),
        "vat": pd.to_numeric(raw[vat_col], errors="coerce"),
    }).dropna()  # drops "TOTAL" rows and footnotes
    df = df.astype({"year": int, "month": int})
    return df


def build_seasonality(dian):
    """12 factors (mean 1.0) describing the yearly shape of economic activity.

    VAT returns are filed every two months, in the month after each period (January-February is paid
    in March). So collection is high in odd months and low in even ones. Treatment:
      1. Each month's share of its year's total, times 12 (removes the yearly level and inflation).
      2. Median across the selected years.
      3. Average each filing pair (Mar-Apr, May-Jun, ..., Jan-Feb) to remove the bimonthly pattern.
      4. Shift back 2 months: collection in Mar-Apr reflects sales of Jan-Feb.
      5. Renormalize so the 12 factors average exactly 1.0.
    """
    d = dian[dian["year"].isin(SEASONALITY_YEARS)].copy()
    counts = d.groupby("year").size()
    if (counts != 12).any():
        raise ValueError(f"Incomplete DIAN years: {counts[counts != 12].to_dict()}")

    d["share"] = d["vat"] / d.groupby("year")["vat"].transform("sum") * 12
    by_month = d.groupby("month")["share"].median().reindex(range(1, 13)).to_numpy()

    # Filing pairs in calendar months: (1,2), (3,4), (5,6), (7,8), (9,10), (11,12).
    paired = by_month.copy()
    for first_month in (1, 3, 5, 7, 9, 11):
        i, j = first_month - 1, first_month  # zero-based indexes of the pair
        paired[i] = paired[j] = (by_month[i] + by_month[j]) / 2

    activity = np.roll(paired, -2)  # factor of month m = collection of month m + 2
    activity = activity / activity.mean()

    return pd.DataFrame({
        "month_of_year": range(1, 13),
        "vat_share_median": np.round(by_month, 4),
        "factor": np.round(activity, 4),
    })


def main():
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    df = load_supersociedades()
    growth = compute_growth(df)
    profiles, margins, growths = build_profiles(df, growth)
    base = build_companies_base(df, margins, growths)

    dian = load_dian_vat()
    seasonality = build_seasonality(dian)
    # Rounding can leave the mean at 0.9999 or 1.0001; fix the last factor so it is exactly 1.0.
    seasonality.loc[11, "factor"] = round(12 - seasonality["factor"].iloc[:11].sum(), 4)

    profiles.to_csv(PROCESSED_DIR / "sector_profiles.csv", index=False, lineterminator="\n")
    seasonality.to_csv(PROCESSED_DIR / "seasonality.csv", index=False, lineterminator="\n")
    base.to_csv(PROCESSED_DIR / "companies_base.csv", index=False, lineterminator="\n")

    print("\nSector profiles:")
    print(profiles.to_string(index=False))
    print("\nSeasonality factors:")
    print(seasonality.to_string(index=False))
    print(f"\ncompanies_base.csv: {len(base)} real records eligible for derived companies")
    print(base["sector"].value_counts().to_string())


if __name__ == "__main__":
    main()
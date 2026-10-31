"""
Phase 2 - Step 3: generate the semi-synthetic monthly series.

Inputs (ml/data/processed/, produced by prepare_data.py):
    sector_profiles.csv, seasonality.csv, companies_base.csv

Outputs (ml/data/processed/):
    monthly_series.csv    the data contract: 500 companies x 36 months, 6 columns
    company_profiles.csv  the hidden parameters of each company (documentation only)

company_profiles.csv contains the true margin, growth and rescaling factor of every company.
It exists so the generation can be audited. It must NEVER be used as a model input.

Run from the repository root:
    python ml/src/generate_series.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = ROOT / "ml" / "data" / "processed"

SEED = 42
N_COMPANIES = 500
DERIVED_SHARE = 0.60
FIRST_MONTH = "2023-01"
N_MONTHS = 36

COLUMNS = ["company_id", "sector", "month", "income", "expenses", "origin"]

# Small-business size: annual income between COP 300 million and COP 6,000 million.
# A company's size rank (0-1) is mapped to this range on a log scale.
ANNUAL_INCOME_RANGE = (300.0, 6000.0)  # millions of COP

# Limits applied to every company's profile (derived or simulated).
MARGIN_CLIP = (-0.10, 0.40)
GROWTH_CLIP = (-0.30, 0.50)

# Noise and hard cases. Calibrated so seasonality stays visible but forecasting is not trivial.
SEASONAL_AMPLITUDE = (0.6, 1.4)     # company multiplier of the DIAN seasonal deviation
INCOME_NOISE_SIGMA = (0.04, 0.10)   # monthly log-noise of income, per company
EXPENSE_NOISE_SIGMA = (0.02, 0.05)  # extra monthly log-noise of expenses, per company
SHOCK_SHARE = 0.15                  # share of companies with a permanent level shift
SHOCK_MONTHS = (6, 33)              # zero-based month range where a shift can start
SHOCK_SIZE = (0.10, 0.25)           # size of the shift, up or down


def allocate(total, shares):
    """Split `total` into integers proportional to `shares` (largest remainder method)."""
    shares = pd.Series(shares, dtype=float)
    exact = shares / shares.sum() * total
    counts = np.floor(exact).astype(int)
    remainder = total - counts.sum()
    order = (exact - counts).sort_values(ascending=False, kind="mergesort").index
    counts[order[:remainder]] += 1
    return counts


def csv_text(df):
    """Serialize exactly as written to disk (used by check_dataset.py to compare hashes)."""
    return df.to_csv(index=False, float_format="%.2f", lineterminator="\n")


def build_profiles(rng, sectors, base):
    counts = allocate(N_COMPANIES, sectors.set_index("sector")["share"])
    rows = []
    for sector in sorted(counts.index):
        n = int(counts[sector])
        candidates = base[base["sector"] == sector].sort_values("nit")
        n_derived = min(int(round(n * DERIVED_SHARE)), len(candidates))

        picked = candidates.iloc[rng.choice(len(candidates), size=n_derived, replace=False)]
        for rec in picked.itertuples():
            rows.append({
                "sector": sector, "origin": "derived", "source_nit": rec.nit,
                "source_income_m": rec.income_m / 12,  # real monthly average, millions of COP
                "margin": rec.margin, "growth": rec.growth, "size_pct": rec.size_pct,
            })

        prof = sectors.set_index("sector").loc[sector]
        for _ in range(n - n_derived):
            rows.append({
                "sector": sector, "origin": "simulated", "source_nit": "",
                "source_income_m": np.nan,
                "margin": rng.normal(prof["margin_median"], prof["margin_spread"]),
                "growth": rng.normal(prof["growth_median"], prof["growth_spread"]),
                "size_pct": rng.uniform(0, 1),
            })

    profiles = pd.DataFrame(rows)
    profiles["margin"] = profiles["margin"].clip(*MARGIN_CLIP)
    profiles["growth"] = profiles["growth"].clip(*GROWTH_CLIP)

    lo, hi = np.log(ANNUAL_INCOME_RANGE[0]), np.log(ANNUAL_INCOME_RANGE[1])
    profiles["base_monthly_income"] = np.exp(lo + profiles["size_pct"] * (hi - lo)) / 12
    profiles["rescale_factor"] = profiles["base_monthly_income"] / profiles["source_income_m"]

    n = len(profiles)
    profiles["seasonal_amplitude"] = rng.uniform(*SEASONAL_AMPLITUDE, n)
    profiles["income_sigma"] = rng.uniform(*INCOME_NOISE_SIGMA, n)
    profiles["expense_sigma"] = rng.uniform(*EXPENSE_NOISE_SIGMA, n)
    has_shock = rng.uniform(0, 1, n) < SHOCK_SHARE
    profiles["shock_month"] = np.where(has_shock, rng.integers(SHOCK_MONTHS[0], SHOCK_MONTHS[1] + 1, n), -1)
    direction = rng.choice([-1.0, 1.0], n)
    profiles["shock_factor"] = np.where(has_shock, 1 + direction * rng.uniform(*SHOCK_SIZE, n), 1.0)

    # Shuffle so that company ids do not reveal the sector or the origin.
    profiles = profiles.iloc[rng.permutation(n)].reset_index(drop=True)
    profiles.insert(0, "company_id", [f"C{i:04d}" for i in range(1, n + 1)])
    return profiles


def build_series(rng, profiles, seasonality):
    months = pd.period_range(FIRST_MONTH, periods=N_MONTHS, freq="M")
    t = np.arange(N_MONTHS)
    season = seasonality.set_index("month_of_year")["factor"].reindex(months.month).to_numpy()

    frames = []
    for p in profiles.itertuples():
        trend = (1 + p.growth) ** (t / 12)
        seasonal = 1 + p.seasonal_amplitude * (season - 1)
        shock = np.where((p.shock_month >= 0) & (t >= p.shock_month), p.shock_factor, 1.0)
        income = p.base_monthly_income * trend * seasonal * shock * np.exp(rng.normal(0, p.income_sigma, N_MONTHS))
        expenses = income * (1 - p.margin) * np.exp(rng.normal(0, p.expense_sigma, N_MONTHS))
        frames.append(pd.DataFrame({
            "company_id": p.company_id,
            "sector": p.sector,
            "month": months.strftime("%Y-%m"),
            "income": np.clip(income, 0, None).round(2),
            "expenses": np.clip(expenses, 0, None).round(2),
            "origin": p.origin,
        }))
    return pd.concat(frames, ignore_index=True)[COLUMNS]


def generate(processed_dir=PROCESSED_DIR):
    """Return (monthly_series, company_profiles). Deterministic for a given set of inputs."""
    sectors = pd.read_csv(processed_dir / "sector_profiles.csv")
    seasonality = pd.read_csv(processed_dir / "seasonality.csv")
    base = pd.read_csv(processed_dir / "companies_base.csv", dtype={"nit": str})

    rng = np.random.default_rng(SEED)
    profiles = build_profiles(rng, sectors, base)
    series = build_series(rng, profiles, seasonality)
    return series, profiles


def main():
    series, profiles = generate()
    (PROCESSED_DIR / "monthly_series.csv").write_text(csv_text(series), encoding="utf-8")
    profiles.round(6).to_csv(PROCESSED_DIR / "company_profiles.csv", index=False, lineterminator="\n")

    print(f"monthly_series.csv: {len(series)} rows, {series['company_id'].nunique()} companies")
    print(profiles.groupby(["sector", "origin"]).size().unstack(fill_value=0).to_string())
    factors = profiles.loc[profiles["origin"] == "derived", "rescale_factor"]
    print(f"\nRescale factor of derived companies (small size / real size): "
          f"median {factors.median():.2e}, min {factors.min():.2e}, max {factors.max():.2e}")
    print(f"Companies with a level shift: {(profiles['shock_month'] >= 0).sum()}")
    print("\nMonthly income (millions of COP):")
    print(series["income"].describe().round(2).to_string())


if __name__ == "__main__":
    main()
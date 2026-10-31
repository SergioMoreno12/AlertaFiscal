# Phase 1 — Business and Data Understanding

- **Project:** AlertaFiscal, Machine Learning course, Universidad de Cundinamarca
- **Owner:** Sergio Steeven Moreno Forero
- **Branch:** `phase1/business-data`
- **Status:** draft for team review (metrics and business criterion to be agreed with Jonathan and Manuel)

> AlertaFiscal is preventive support for tax planning. It is not accounting or tax advice. Every number it shows is an estimate that the business owner or their accountant must review.

---

## 1. Problem statement

**Who is the user?** The owner of a small Colombian business, or the accountant who manages several small businesses.

**What is their problem?** Small businesses pay taxes (VAT, income tax, withholdings) out of the same cash they use to operate. They usually find out how much they owe when the filing date arrives, not months before. When income drops or expenses rise unexpectedly, the money for taxes is not set aside, and the business must borrow, pay late or pay interest.

**What does the model predict?** The company's **monthly income** and **monthly expenses**, in millions of COP, for each of the **next 6 months**, using the company's own past 36 months of figures.

**Which decision does it support?** How much money to reserve each month for upcoming tax payments. With a forecast of income and expenses, the business can estimate its future tax base and plan its cash before the obligation is due.

**Where are the alerts?** Alerts are a consequence of the plan, never the goal of the model. They are simple, documented rules applied to the forecast (for example, "projected expenses exceed projected income next month"). They are specified in [`03_alert_rules.md`](03_alert_rules.md).

**What will the system not do?** It does not classify companies by tax risk, does not predict penalties, does not compute or file tax returns, does not connect to the DIAN and does not replace an accountant. See section 9.

## 2. Users and use case

| User | Need | How AlertaFiscal helps |
|---|---|---|
| Small business owner | Know in advance how much cash to set aside for taxes | 6-month forecast of income and expenses, plus plan-based alerts |
| Accountant with several clients | Know which client needs attention first | Same forecast per client; alerts show where the plan looks tight |

**Typical use case**

1. The business records its monthly income and expenses in the AlertaFiscal ERP (ported from AlertaFiscalBeta).
2. Once it has enough history, the ML module forecasts the next 6 months of income and expenses.
3. The app shows the forecast, an estimated monthly reserve and any plan-based alerts.
4. The owner or accountant reviews the plan and decides how much to reserve.

## 3. Objective of the model

Build a time-series forecasting model that, for each company, estimates monthly `income` and `expenses` for a **6-month horizon** from its previous months, and that is **more accurate than a simple baseline** on months and companies it has not seen during training.

- **Type of problem:** supervised regression over time series (forecasting), not classification.
- **Input:** the company's past monthly `income` and `expenses`, its `sector` and the month of the year.
- **Output:** 6 monthly values of `income` and 6 of `expenses`, in millions of COP.
- **Baseline to beat:** *seasonal naive*, that is, "the same value as the same month of last year". A second reference is the average of the last 3 months.

Model choice and hyperparameters belong to Phase 3 (Jonathan). This phase only defines what "good enough" means.

## 4. Success metrics

### 4.1 Technical metrics

| Metric | Role | What it means in this project |
|---|---|---|
| **MAE** (mean absolute error) | Main | "On average, the forecast misses by X million COP per month." Same unit as the data, easy to explain. |
| **RMSE** (root mean squared error) | Main | Like MAE but punishes large misses more. If RMSE is much bigger than MAE, a few forecasts are very bad. |
| **MAPE** (mean absolute percentage error) | Secondary | Error as a percentage of the real value. **Caveat:** it breaks when real values are close to zero (a month with almost no income gives a huge percentage), so it is reported but never used alone to choose a model. |

All metrics are computed separately for `income` and `expenses`, over the full 6-month horizon, on the `validation` months (25–30) to choose a model, and on the `test` months (31–36) and the `holdout` companies to report the final result.

### 4.2 Reference criterion

The chosen model must have a **lower MAE than the seasonal naive baseline** on the validation months, for both `income` and `expenses`. Proposed minimum improvement: **at least 10 % lower MAE than the baseline**. A smaller improvement is not worth the extra complexity.

### 4.3 Business criterion (proposal to agree)

> **The average monthly forecast error (MAE) must stay below 15 % of the company's average monthly income**, measured on the test months and on the holdout companies.

Formally, for each company *c*:

```
relative_error(c) = MAE(c) / mean_monthly_income(c)
```

The criterion is met when the **median** `relative_error` across companies is **≤ 15 %**, and the 90th percentile is ≤ 30 %.

**Why 15 %?**

- The forecast is used to decide a tax reserve, not to file a tax return. An error of 15 % of monthly income moves the estimated reserve by only a fraction of that amount (the tax is a percentage of the base), which a small business can absorb with a safety margin.
- Small businesses usually work with net margins around 5–15 %. An error clearly larger than that could turn a projected profit into a projected loss and trigger wrong alerts.
- It is normalized by income, so it is comparable between a company that sells COP 20 million per month and one that sells COP 300 million.
- Using the median (not the mean) prevents a few very small companies from dominating the result. The 90th percentile limit ensures the model is not useless for a large group of companies.

Manuel (Phase 4) uses this criterion as the acceptance test. If the team agrees on a different value, this section is updated before November 3, 2026.

## 5. Data inventory

Both datasets were downloaded on **October 28, 2026**. Raw files are not committed to the repository; Samuel keeps them and the processed files are produced by the Phase 2 scripts.

| | Supersociedades — 10,000 largest companies | DIAN — Monthly tax collection by type of tax |
|---|---|---|
| **Publisher** | Superintendencia de Sociedades, via Colombia's open data portal (datos.gov.co) | Dirección de Impuestos y Aduanas Nacionales (DIAN) |
| **Link** | https://www.datos.gov.co/Comercio-Industria-y-Turismo/10-000-Empresas-mas-Grandes-del-Pa-s/6cat-2gcs | https://www.dian.gov.co/dian/cifras/Paginas/EstadisticasRecaudo.aspx |
| **Format** | CSV / Socrata API | Excel (`.xlsx` inside a `.zip`) |
| **License** | CC BY-SA 4.0 | Public information (Law 1712 of 2014) |
| **Content** | Annual figures per company: NIT, name, region, department, city, CIIU code, macrosector, operating income, profit or loss, assets, liabilities, equity, cutoff year | Gross national tax collection per month and per type of tax (income tax, withholding, VAT, financial transactions tax, stamp, consumption, RST, customs, imported VAT) |
| **Unit** | Trillions of COP (Spanish *billones*, 10¹²) | Millions of current COP |
| **Time range** | Annual cutoffs 2021–2025 (≈ 50,000 rows) | Monthly, January 2000 – August 2026 |
| **What it lacks** | Monthly figures; expenses are not reported directly (estimated as income minus profit); small businesses | Any company-level information; it is a national total |
| **Use in the project** | Real company profiles: sector, net margin, annual growth, size distribution per sector | Shape of the yearly seasonality of economic activity (which months are higher or lower) |
| **Main limits** | Only the largest companies; coarse rounding for small values | National and aggregated; VAT has a bimonthly filing pattern |

## 6. Known data problems and treatment

| # | Problem | Why it matters | Proposed treatment |
|---|---|---|---|
| 1 | **Supersociedades values are quantized below 0.05 trillion COP** (COP 50,000 million). Small values are rounded to coarse steps, so many of the smallest companies have identical figures. | Margins and growth computed from rounded values are unreliable and make different companies look identical. | Do not take margins from quantized records directly. Use sector-level distributions (median and spread of margin and growth) computed from non-quantized records, and sample from them. Records that are quantized are used only for `sector`, and their profile is marked `simulated`. |
| 2 | **DIAN VAT is filed every two months**, so monthly VAT collection jumps in filing months and drops in the others. | If used as-is, the generator would create a false bimonthly pattern in every company's income. | Smooth the seasonality over 2-month windows (average each pair of consecutive months) before using it as the seasonal shape. |
| 3 | **DIAN figures are national, never per company.** | Treating them as a company's tax would be wrong and misleading. | Use DIAN only for the *shape* of seasonality (relative index per month, average = 1). Never use its values as any company's income, expenses or VAT. |
| 4 | **Supersociedades covers only the largest companies**, while AlertaFiscal targets small businesses. | Absolute values are thousands of times larger than a small business. | Keep only relative quantities (margin, growth, seasonality) and rescale every company to small-business size. Samuel documents the rescaling factor in Phase 2. This limit is stated in the honesty section and in the app. |
| 5 | **Unit confusion:** Supersociedades reports in *billones* (10¹²), which is "trillions" in English, not "billions". | Off by a factor of 1,000 if misread. | All documents state the unit explicitly. The processed dataset uses millions of COP everywhere. |

## 7. Real vs simulated: honesty statement

**The data used to train the model is semi-synthetic: generated by a program and calibrated with real public statistics.**

| Real (taken from public data) | Simulated (generated by the team's program) |
|---|---|
| Annual aggregates per company from Supersociedades (income, profit, sector) | Every monthly `income` and `expenses` value of every company |
| Net margin and annual growth distributions per sector | The company identities (`C0001`–`C0500`); no real company is represented |
| Shape of yearly seasonality from DIAN collection | The month-to-month noise and variations |
| | The rescaling to small-business size |

The `origin` column says how each company's *profile* was built: `derived` (from a real Supersociedades record) or `simulated` (sampled from the sector distributions). **In both cases, the monthly values are simulated.**

**How the team presents it**, in the app, the report and the presentation:

> "The model was trained on semi-synthetic data calibrated with public statistics from Supersociedades and the DIAN. The results show that the method works technically; they do not prove the accuracy of the forecast for a real business."

The team never calls the data "real company data". Validating the model with real, anonymized and authorized data from partner accountants is future work.

## 8. Risks and limits

| Risk or limit | Effect | Mitigation |
|---|---|---|
| Short history: only 36 months per company | Only 3 cycles of each month to learn seasonality; long horizons are uncertain | Horizon limited to 6 months; compare against the seasonal naive baseline |
| Semi-synthetic data | The model may learn the generator's rules instead of real behavior | Honest presentation; noise and hard cases in the generator; holdout companies |
| No individual company data | Results cannot be validated on real businesses | Stated as a limit; real validation listed as future work |
| Large-company data used to represent small businesses | Margins and seasonality of large firms may differ from small ones | Use only relative quantities; rescale; state the limit |
| Users may read the forecast as tax advice | Wrong decisions about real obligations | Disclaimer in the app and every document; the accountant has the final word |
| Data leakage between train and test | Results look better than they are | Split by time (months 1–24 / 25–30 / 31–36) and by company (15 % holdout), defined in `split_manifest.csv` |
| Personal data (Law 1581 of 2012) | Real users' data would be personal or business-sensitive | No real personal data is used in this project; any future real data must be anonymized and authorized |

## 9. Out of scope

AlertaFiscal will **not**:

- Classify companies by tax risk or produce a risk score.
- Predict whether the DIAN will audit or sanction a company.
- Compute, prepare or file tax returns, or connect to the DIAN.
- Give tax or accounting advice, or replace an accountant.
- Be a complete accounting ERP: only what is needed to record monthly figures and show the plan.
- Forecast beyond 6 months.

---

## Glossary

- **Time series:** values of one quantity measured month after month, such as a company's income.
- **Forecast / projection:** estimate of future months from past months.
- **Horizon:** how many months ahead the forecast goes (6 in this project).
- **MAE:** average size of the error, in millions of COP.
- **RMSE:** like MAE but large errors weigh more.
- **MAPE:** average error as a percentage of the real value; unreliable near zero.
- **Baseline:** a very simple forecast that any real model must beat.
- **Seasonal naive:** baseline that repeats the value of the same month of last year.
- **Semi-synthetic data:** data generated by a program, shaped by real statistics.
- **Seasonality:** repeating pattern during the year, for example higher income in December.
- **Holdout companies:** companies the model never sees during training, used to test generalization.
- **Data leakage:** using information in training that would not exist at prediction time.

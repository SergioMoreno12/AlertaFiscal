# PHASE 1 — Business and Data Understanding

- **Owner:** Sergio Steeven Moreno Forero
- **Branch:** `phase1/business-data`
- **Deadline:** November 3, 2026
- **Does it need code?** Almost none. This is a documentation and analysis phase. The only optional code is one exploration notebook.

## 1. Why this phase exists
Everyone else's work depends on what you write here. Before anyone programs, the team needs a written answer to: what problem does AlertaFiscal solve, for whom, with which data, and where does it stop? If this is vague, Phases 2 to 6 will each interpret the project differently.

## 2. Context you must understand first
- AlertaFiscal helps **small businesses plan their tax burden** by forecasting monthly income and expenses.
- The professor asked for **fiscal planning**, not risk classification. Alerts are a consequence of the plan, never the goal of the model.
- The product is a port of the AlertaFiscalBeta ERP (built for another course). This course adds the ML forecasting module.
- The tool is **preventive support, not accounting or tax advice**.
- Data sources: Supersociedades "10,000 largest companies" (CSV) and DIAN monthly tax collection (Excel).

## 3. What you must do
1. **Problem statement** (1 page): who the user is, what they need, what the model predicts, which decision the forecast supports.
2. **Success metrics**: MAE, RMSE and MAPE for the forecast, plus one business criterion (for example, the maximum acceptable monthly error as a percentage of income). Explain in plain words what each metric means and why MAPE can mislead when values are close to zero.
3. **Data inventory** for each source: what it contains, what it lacks, how it was obtained, and its limits.
4. **Known data problems** and the proposed treatment:
   - Supersociedades: values are quantized below 0.05 billion COP.
   - DIAN: VAT is filed every two months, so seasonality must be smoothed over 2-month windows.
   - Neither source has company-level monthly series, so the monthly dataset is semi-synthetic.
5. **Data dictionary** for the new dataset, which has exactly 6 columns: `company_id`, `sector`, `month`, `income`, `expenses`, `origin`. For each one: type, unit, expected range, source, and whether it is derived or simulated.
6. **Honesty section**: say clearly what is derived from real data and what is simulated. Simulated data must never be presented as real company data.
7. **Risks and limits**: short history, semi-synthetic data, no individual company information, no tax advice.
8. **Out-of-scope list**: what the project will NOT do (risk scoring, sanction prediction, official tax filing).
9. Optional: `ml/notebooks/01_eda.ipynb` with income/expense distributions by sector and the DIAN seasonality curve. Keep it short and commented.

## 4. What you must NOT do
- Do not train models or choose hyperparameters (Phase 3).
- Do not edit anything in `ml/src/` (owned by Samuel and Jonathan).
- Do not present a risk score or "risk classification" as the model objective.
- Do not describe simulated data as real.
- Do not commit directly to `main` or `develop`.
- Do not write anything in Spanish. All files and commits are in English.

## 5. Deliverables
- `docs/01_business_and_data.md`
- `docs/02_data_dictionary.md`
- Optional: `ml/notebooks/01_eda.ipynb`
- Receivers: Samuel (Phase 2) and Jonathan (Phase 3).

## 6. How to work in the branch
1. `git checkout phase1/business-data`
2. `git pull origin phase1/business-data`
3. Create the files and commit in small steps, in English (example: `docs: add data dictionary`).
4. `git push origin phase1/business-data`
5. When finished, open a Pull Request into `develop` and ask a teammate to review it.

## 7. Definition of done
- [ ] The model objective and the metrics are written and consistent.
- [ ] All 6 columns are documented with type, unit and source.
- [ ] Each known data problem has a proposed treatment.
- [ ] The derived vs simulated distinction is explicit.
- [ ] A teammate read the documents and understood them without asking you questions.
- [ ] Pull Request merged into `develop`.

## 8. What you must be able to explain at the final presentation
- Why the project moved from risk classification to fiscal planning.
- Which datasets were used, where they come from and their limits.
- Why the dataset is semi-synthetic and how the team avoids misleading anyone with it.
- What each metric means and when a forecast is good enough.
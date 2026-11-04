# Design decisions — limited stage 2

Record of decisions with their context, the discarded alternative and the real status. Decisions marked **deferred** are not implemented and must not be presented as done.

## D1. External context is context, not a label or a predictor

**Context.** DIAN collection data and Supersociedades aggregates are available.

**Decision.** They are added as labeled reference information. They do not train the model, they are not non-compliance labels and they create no alerts or tasks.

**Why.** National collection does not say what a company had to pay; sector aggregates of the 10,000 largest companies do not represent a small business. Using them as predictors would leak information and produce invalid comparisons.

**Status.** Implemented: the API and the screen show an explicit notice and the loader never touches the alerts table.

## D2. No join by NIT and no artificial joins between sources

**Context.** Both sources have NITs or identifiers, but for different purposes.

**Decision.** There is no join by NIT with ERP companies or between sources. National totals are not added up as if they were independent observations.

**Why.** The same NIT can appear in different forms, and each source has a different coverage. A join would produce false positives and double counts.

**Status.** Implemented: the schema has no foreign key to `companies`, and the aggregates are stored by year/metric/sector or by period/series.

## D3. Store aggregates, not a per-company table

**Decision.** `tax_collections` and `sector_benchmarks` are stored. No "context per company" table is created.

**Why.** The intended use is comparing aggregated magnitudes, not stating individual facts. A per-company table would invite an improper join.

**Status.** Implemented.

## D4. Logical source separate from acquisition version

**Context.** A source is updated several times and can change without notice.

**Decision.** `external_sources` describes the source; `external_dataset_versions` describes each acquisition. The identity is the content hash, not the date label. More than one download is allowed, and only one current version per source, through a partial unique index.

**Why.** Overwriting the previous version would make it impossible to audit what was known at each moment. The date label can repeat if two downloads happen in the same second.

**Status.** Implemented: `uq_external_version_current (source_id) WHERE is_current`.

## D5. Offline acquisition and explicit loading

**Decision.** The network is used only when running `ml.company_trainer.sources.acquire`. Processing and loading are offline. Flask does not download, does not train on startup, runs no automatic seeds, and the API never goes to the internet.

**Why.** Reproducibility, auditability and a predictable startup. It also prevents an outage of the source from blocking the application.

**Status.** Implemented.

## D6. Licenses: evidence and caution

**Context.** Supersociedades declares CC BY-SA 4.0. The DIAN does not declare an explicit reuse license on the page consulted.

**Decision.** Evidence of the Supersociedades license is kept (`docs/erp/evidence/supersociedades-license.json`) and the DIAN uncertainty is recorded (`docs/erp/evidence/dian-license-uncertainty.md`) with status `uncertain`. Raw files are not committed or redistributed. No legal prohibition is claimed.

**Why.** The label "public information" alone is not a redistribution license. The conservative position avoids misuse without making up a legal conclusion.

**Status.** Implemented. Before publishing DIAN derivatives, the source must be reviewed or permission requested.

## D7. Reserves and plan versioning

**Context.** `FiscalPlanVersion.estimated_reserve` is a plan **target**. `ReserveEntry` is a **recorded reserve**, with an optional `plan_version_id`. Versioning a plan creates a new version and does not rewrite the previous one.

**Decision.** The separation between reserve target and recorded reserve is kept. A reserve keeps the reference to the version it was recorded with; versioning neither loses nor duplicates it. The coverage is not yet changed to add only the reserves of the current version.

**Why.** Changing the coverage without an explicit policy would make a historical reserve disappear from the indicator or count twice. First it must be defined how a reserve is kept when versioning and how "reserved" differs from "assigned to the plan".

**Status.** Current behavior tested in `backend/tests/test_context.py` (`test_versioning_plan_does_not_lose_or_duplicate_reserves`). The new coverage policy is **deferred**.

## D8. Out-of-date forecast

**Context.** A forecast depends on the inputs used to generate it. Changing a reserve or reviewing an alert does not change historical income or expenses.

**Decision.** The forecast stores the real inputs and a signature (hash) of those inputs. Changes to reserves or to alert reviews do **not** invalidate it. Only a change in the forecast inputs justifies marking it out of date.

**Why.** Invalidating on unrelated changes would force recomputation for no reason and hide the difference between "an input changed" and "another part of the plan changed".

**Status.** Implemented later: every model run stores `history_signature` in its assumptions, and the alert rule "Forecast out of date because the inputs changed" compares it with the current history.

## D9. Alert life cycle and informative context

**Context.** The current alerts have no `code`, `period`, resource or `resolved_at`. `TaxObligation` has a single `status`, without separating filing, payment and review.

**Decision.** Informative context creates no pending alerts or accountant tasks by default. Actionable rules come first, with review, resolution, dismissal, active condition and reappearance defined. A justified dismissal is not reopened without an explicit policy. The audit trail is kept.

**Why.** Creating alerts from national figures would produce noise and false positives; without deduplication they would also repeat on every load.

**Status.** Rule alerts are deduplicated by title + origin + open status. The context loader records audit events (`context.load`, `context.record`) but creates no alerts.

## D10. ML protocol and data

**Context.** The ERP's own baseline used 18 months of one company; the second company had one month and was skipped with `--min-months 12`.

**Decision.** It is not claimed that 24–36 months guarantee the universal validity of an MLP. The real or simulated origin of the data, the effective examples, the lags, the horizon, the windows and the complexity are documented. Reported metrics are explained with their protocol (company, months, horizon, method and MAE).

**Why.** Performance depends on the series, the seasonality and the horizon; a number of months is not a guarantee. With little data, an MLP is not defensible as a business model.

**Status.** Documented. The course project replaced the per-company experiment with a global model trained on 425 companies and evaluated once on test and holdout data (`docs/04_evaluation_report.md`); a company artifact still takes priority when it exists.

## D11. Git and baseline commit

**Decision.** No commit, push or deployment without explicit approval. The lack of a commit is not an ERP vulnerability: it is a preparation state.

**Status.** Superseded: the ERP was ported into the AlertaFiscal repository on the `erp-port` branch. See `docs/erp/baseline-commit.md`.

## D12. PostgreSQL as the validation database

**Decision.** Integration tests run against PostgreSQL. SQLite is used only for quick tests and demos, never to claim that the integration is validated.

**Status.** Implemented: CI runs the whole suite against PostgreSQL 16; locally, without `TEST_DATABASE_URL`, the PostgreSQL tests are skipped by design.

## D13. Robust detection of total rows in the regional sheet

**Context.** During visual checks, the "Regional offices 2026" card showed 483,023,511,857,290 COP, exactly twice the 2026 national total. The cause was a row `TOTA  AÑO 2026` (without the L and with a double space) that the filter `startswith("TOTAL")` did not catch and that was added as if it were a regional office. The sheet also uses `TOTAL_AÑO_2010`.

**Decision.** Normalize accents, separators and spaces before comparing, and validate the processed files with `python -m ml.company_trainer.sources.validate`. The validation checks that no total row is kept as a regional office and that the regional sum matches the national total in the comparable years.

**Why.** A literal prefix filter is fragile against typos and source variants. A visual check alone would not have found the problem without looking at the figure; the automatic validation would have.

**Status.** Implemented. The CSV went from 28,088 to 28,064 rows and the 2026 reconciliation ended at 0.01 COP. The regional-national comparison is required only from 2013, because before that the sheet does not cover all national collection.

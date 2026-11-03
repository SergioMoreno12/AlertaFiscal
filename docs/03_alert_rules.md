# Plan-Based Alert Rules

- **Owner:** Sergio Steeven Moreno Forero (Phase 1)
- **Status:** proposal for team review. Thresholds are agreed with the team before Phase 5 implements them.

Alerts are a **consequence of the plan, never the goal of the model**. The model only forecasts monthly `income` and `expenses`. Each alert below is a fixed rule applied to that forecast and to the company's history, so it can be programmed without interpretation. Alerts never say a company is "at risk"; they point at months of the plan worth reviewing.

> AlertaFiscal is preventive support. It is not accounting or tax advice.

## Inputs available to every rule

| Name | Meaning | Unit |
|---|---|---|
| `inc_hat[m]`, `exp_hat[m]` | Forecast income and expenses for future month `m`, `m = 1..6` | millions of COP |
| `inc[t]`, `exp[t]` | Real income and expenses of past month `t` (the last real month is `t = 0`) | millions of COP |
| `inc_ly[m]` | Real income of the same calendar month one year before `m` | millions of COP |
| `avg_inc_12` | Mean of `inc` over the last 12 real months | millions of COP |
| `mae_inc` | MAE of the deployed model for `income` on the test months (from `metrics.json`) | millions of COP |

Definitions used below:

- `margin_hat[m] = inc_hat[m] - exp_hat[m]`
- `net_6 = sum(margin_hat[1..6])`

## Rules

| ID | Name | Condition (fires when true) | Level | Message shown |
|---|---|---|---|---|
| A1 | Projected loss month | For any `m` in 1..6: `exp_hat[m] > inc_hat[m]` | Warning | "Month {m}: projected expenses exceed projected income by {exp_hat[m] - inc_hat[m]} million COP. Review the cash reserved for taxes." |
| A2 | Income drop | For any `m` in 1..6: `inc_hat[m] < 0.80 × inc_ly[m]` (drop of 20 % or more vs the same month last year) | Warning | "Month {m}: projected income is {pct}% lower than the same month last year." |
| A3 | Tight 6-month plan | `net_6 < 0.05 × sum(inc_hat[1..6])` (projected 6-month margin below 5 % of projected income) | Warning | "The next 6 months show a projected margin below 5 %. Consider reserving for taxes earlier." |
| A4 | Expense growth | `mean(exp_hat[1..3]) > 1.25 × mean(exp[-2..0])` (next 3 months' expenses 25 % or more above the last 3 real months) | Info | "Expenses are projected to grow {pct}% over the next 3 months." |
| A5 | Low forecast confidence | `mae_inc > 0.15 × avg_inc_12` (model error above the 15 % business criterion for this company's size) | Info | "This forecast is less reliable for your company's size. Review it with your accountant." |
| A6 | Not enough history | Fewer than 12 real months available | Blocking | "At least 12 months of history are needed to produce a forecast." (No forecast or other alert is shown.) |

### Evaluation order

1. A6 is evaluated first. If it fires, no forecast is produced and no other rule is evaluated.
2. A1–A5 are evaluated independently; several can fire at once.
3. A1 and A2 report every month that fires, in calendar order.
4. Percentages in messages are rounded to whole numbers; amounts to two decimals.

### Edge cases

- **A2 when `inc_ly[m] = 0`:** the rule does not fire for that month (no meaningful comparison).
- **A3 when `sum(inc_hat[1..6]) = 0`:** A3 fires.
- **A4 when `mean(exp[-2..0]) = 0`:** the rule does not fire.
- Negative forecasts are clipped to 0 before applying any rule (income and expenses cannot be negative, per the data contract).

## Why these thresholds

| Threshold | Reason |
|---|---|
| 20 % income drop (A2) | Large enough to exceed normal month-to-month noise, small enough to warn before the tax reserve is clearly insufficient. |
| 5 % margin (A3) | Lower end of typical small-business net margins; below it, any tax payment competes with operating cash. |
| 25 % expense growth (A4) | Clearly above normal seasonal variation over 3 months. |
| 15 % error (A5) | Same value as the business criterion in [`01_business_and_data.md`](01_business_and_data.md), section 4.3. |
| 12 months (A6) | A full year is the minimum to observe each calendar month once (needed for A2 and seasonality). |

All thresholds are named constants in the implementation (Phase 5), so they can be changed in one place if the team agrees.

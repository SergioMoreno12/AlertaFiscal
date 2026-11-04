# Baseline commit: status, checks and approval (historical record)

Record of the initial local commit of the ERP working copy (`PROYECTO_FINAL_MACHINE`), before it was ported into this repository. At that time **no remote was configured and nothing was pushed**. Since November 3, 2026 the ERP lives in the AlertaFiscal repository (branch `erp-port`, ported by Manuel Eduardo Alarcon Aza); this file is kept as history.

## 1. Status before the commit

| Check | Result |
|---|---|
| `git rev-parse --verify HEAD` | Failed: the repository **had no commits** (unborn branch) |
| `git remote -v` | Empty: **no remote configured** |
| `git status --short` | 82 entries (unique files) |
| Staged (`git diff --cached`) | 64 files |
| Unstaged changes (`git diff --name-only`) | 18 files |
| Untracked (`git ls-files --others --exclude-standard`) | 27 files |

The 18 files with unstaged changes were edits after the first staging (for example `README.md`, `docs/sources.md`, `docs/decisions.md`, `frontend/src/app/App.tsx`, `ml/train.py`). The 27 untracked files included the context module, the migration `f3b8c2d1a7e4`, the source scripts and manifests, the new tests, the source documentation and two user documents.

Distribution of the 64 staged files: `backend/` 39, `frontend/` 14, `docs/` 4, `ml/` 3, plus `README.md`, `.gitignore`, `render.yaml` and `.github/workflows/ci.yml`.

## 2. Files that must not be committed

Checked with `git check-ignore -v`:

| Path | Rule |
|---|---|
| `backend/.env` | `.env` |
| `.env.docker` | `.env.*` |
| `ml/data/` (raw and processed) | ignored |
| `frontend/node_modules/` | ignored |
| `backend/.venv/` | ignored |
| `backend/dev.db` and `*.db` | ignored |
| `frontend/dist/` | ignored |

There were no databases, DIAN/Supersociedades raw files, virtual environments or `node_modules` among the staged or untracked files.

## 3. Secret and improper file scan

The 86 staged or untracked text files were scanned with these patterns:

| Pattern | Matches | Meaning |
|---|---|---|
| `BEGIN (RSA\|OPENSSH\|EC\|PGP) PRIVATE KEY` | 0 | No private keys |
| `AKIA[0-9A-Z]{16}` | 0 | No AWS keys |
| `gh[pousr]_[A-Za-z0-9]{20,}` | 0 | No GitHub tokens |
| `sk-[A-Za-z0-9]{20,}` | 0 | No OpenAI-style API keys |
| `xox[baprs]-...` | 0 | No Slack tokens |
| `postgres(ql)?://user:password@` | 2 | **CI/test-only** credentials (see below) |
| `password = "..."` | 1 | Documented demo password |
| `SECRET_KEY = "..."` | 0 | No embedded secret |

The three matches are expected and are not real secrets:

- `.github/workflows/ci.yml` → `postgresql://alertafiscal:alertafiscal@localhost:5432/alertafiscal_ci` is the workflow's own ephemeral PostgreSQL service.
- `backend/tests/test_config.py` → `postgresql://u:p@127.0.0.1:5432/db` is a fictitious URL used to test configuration parsing.
- `backend/app/seed.py` → `DEMO_PASSWORD = "demo2026"` is the demo credential documented in `README.md`; the seed only runs manually.

No real `.env`, `.pem` or `.key` files, backups, screenshots or large binaries were among the candidates. The only untracked binaries were two user documents (point 4).

## 4. Untracked user documents

| File | Size | Recommendation |
|---|---|---|
| `Guia_Pruebas_Locales_AlertaFiscal.docx` | 42.1 KB | Decide whether it is part of the deliverable; otherwise leave it out |
| Empathy map template (PDF) | 1,655.6 KB | Design material; probably outside the code repository |

Neither is needed to run or test the system. They were **not included** in the baseline commit, so presentation material is not mixed with code and a 1.6 MB PDF is kept out of the history. They were not ported either.

## 5. Contents of the baseline commit

A single initial commit with the whole state (application, tests, migrations, documentation and limited stage 2), excluding the two documents of point 4:

- Base ERP: auth with session/CSRF, companies, movements, planning, tracking and alerts.
- Read-only external context (limited stage 2): sources, versions, DIAN aggregates and sector benchmarks; authenticated API and a secondary screen. It does not feed the forecast or create alerts.
- Migration `f3b8c2d1a7e4` (new tables only, with downgrade).
- Offline acquisition and processing scripts, versioned manifests, license evidence and a reproducible validator.
- Tests: 30 passed and 10 skipped on SQLite; 40 passed on PostgreSQL.

It was not split into "baseline" and "stage 2" because several files (`backend/app/models.py`, `backend/app/__init__.py`, `frontend/src/app/App.tsx`, `ml/train.py`, `README.md`) already contained changes of both stages; splitting them would have required rebuilding intermediate versions and produced an artificial history.

## 6. Checks run before the commit

| Check | Result |
|---|---|
| `npm run build` (`tsc --noEmit && vite build`) | Passed; warning about a chunk > 500 kB, not blocking |
| `pytest` with temporary SQLite | 30 passed, 10 skipped by design |
| `pytest` with a PostgreSQL `TEST_DATABASE_URL` | 40 passed |
| `python -m ml.sources.validate` | Exit 0; 28,064 DIAN rows and 175 benchmarks consistent with the manifest |
| Secret scan | No real findings (3 justified matches) |
| `git check-ignore` | `.env`, `.env.docker`, `ml/data`, `node_modules`, `.venv`, `*.db` ignored |

Git's `LF will be replaced by CRLF` warnings are normal on Windows and do not change the logical content.

## 7. Approval and status at that time

- [x] Migration `f3b8c2d1a7e4` applied **only** to the local development database `alertafiscal`, with a verified prior backup.
- [x] `Guia_Pruebas_Locales_AlertaFiscal.docx` and the PDF excluded from the commit and kept on the computer.
- [x] Initial local commit created; no remote and no push.
- [ ] Configure a remote or push: **not approved** at that time (later done through the port to this repository).
- [ ] Rename the branch: **not approved**.
- [ ] Delete `alertafiscal_verify_test` or any database or volume: **not approved** in that task.

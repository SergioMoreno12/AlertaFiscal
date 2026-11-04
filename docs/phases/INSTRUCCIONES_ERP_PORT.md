# INSTRUCTIONS TO COMPLETE THE `erp-port` BRANCH – ALERTAFISCAL

**Reviewed on November 3, 2026**

- **Who does it:** Manuel Eduardo Alarcon Aza, from November 3, 2026 (Phase 5 was handed over from Samuel Castellanos Rivera).
- **Reviewer:** Sergio Steeven Moreno Forero.
- **Same content as:** section 6.1 of `docs/phases/PHASE_5_INSTRUCTIONS.md` on `phase5/flask-api`. If the two differ, that file wins.

---

## Current status of `erp-port`

| Item | Status |
|---|---|
| Branch created from `develop` | Done (Samuel) |
| Old Flask site moved to `legacy_flask_site/` | Done (Samuel, commit `f3ff356`) |
| ERP `.gitignore` | Done (Samuel, commit `36ea70c`) |
| ERP code (`backend/`, `frontend/`, `ml/company_trainer/`, `docs/erp/`, deployment files) | **Missing: steps 0-6 below** |
| Backend tests and frontend build | **Missing: steps 7-9** |
| Commits and Pull Request into `develop` | **Missing: steps 10-11** |
| Raw data committed on `phase5/flask-api` | **Missing: step 12** |

Manuel, the `erp-port` branch already contains the old website in `legacy_flask_site/` and the ERP `.gitignore` file. The remaining tasks are to bring in the ERP (steps 1–5), test it, and open the PR (step 11). Everything else in Phase 5 depends on this, and the temporary placeholder model is due on November 6.

In the commands below, replace `ERP_PATH` with the folder containing `PROYECTO_FINAL_MACHINE` (for example, `C:\Users\manuel\Desktop\PROYECTO_FINAL_MACHINE`). If you do not have that folder, ask Samuel for it (the ERP zip he received). Do not copy it from the repository of anyone else.

All commands are for PowerShell and must be run from the root directory of the AlertaFiscal repository.

## 0. BEFORE YOU START

```powershell
git checkout erp-port
git pull origin erp-port
git status
```

`git status` must report that there are no changes. If there are any changes, let us know before proceeding.

## 1. COPY THE BACKEND (excluding local files)

```powershell
robocopy "ERP_PATH\backend" "backend" /E /XD .venv* instance __pycache__ .pytest_cache node_modules* /XF .env *.db *.pyc
```

Do not copy: `.venv`, `.env`, `instance/` (this is where `dev.db` is stored), `__pycache__`, or `.pytest_cache`.

## 2. COPY THE FRONTEND (excluding node_modules and dist)

```powershell
robocopy "ERP_PATH\frontend" "frontend" /E /XD node_modules* dist .vite
```

Note: The `node_modules_incompatible_otro_pc` folder must also be excluded. The `node_modules*` pattern already excludes it.

## 3. COPY THE PER-COMPANY TRAINER TO `ml/company_trainer/`

```powershell
New-Item -ItemType Directory -Force ml\company_trainer
Copy-Item "ERP_PATH\ml\train.py", "ERP_PATH\ml\requirements.txt", "ERP_PATH\ml\README.md" ml\company_trainer\
robocopy "ERP_PATH\ml\sources" "ml\company_trainer\sources" /E /XD __pycache__
```

**DO NOT** copy the ERP's `ml\data\raw` directory (the DIAN data license terms are unclear).

Our `ml\src`, `ml\data`, and `ml\artifacts` directories already exist. Do not modify them.

Next, open `ml\company_trainer\train.py` and update any paths that point to `"ml/..."` so they work from the new directory.

## 4. COPY THE ERP DOCUMENTATION TO `docs/erp/`

```powershell
New-Item -ItemType Directory -Force docs\erp
Copy-Item "ERP_PATH\docs\*.md" docs\erp\
robocopy "ERP_PATH\docs\evidence" "docs\erp\evidence" /E
```

Do not modify our existing documents (`01_` through `07_`) or anything under `docs/phases`.

## 5. COPY THE DEPLOYMENT FILES TO THE ROOT DIRECTORY

```powershell
Copy-Item "ERP_PATH\render.yaml", "ERP_PATH\compose.yaml" .
robocopy "ERP_PATH\docker" "docker" /E
robocopy "ERP_PATH\.github" ".github" /E
Copy-Item "ERP_PATH\.env.docker.example" .   # Only if it exists
```

- Check the workflows under `.github/workflows` to ensure that paths to `backend/` and `frontend/` are still correct.
- `.vscode`: The current `.gitignore` excludes this directory. The simplest option is **NOT** to copy it.
- `README.md`: **DO NOT** replace the current README yet. It will be rewritten in step 16.

## 6. FILES THAT MUST NEVER BE COPIED

- The ZIP's `.git` directory.
- `.venv*`, `node_modules*`, `dist/`.
- `backend\.env` and `.env.docker` (only `.env.docker.example` is allowed).
- `backend\instance\dev.db`.
- `ml\data\raw\`.
- `PROTOTIPO_ALERTA_FISCAL.zip`.
- `Guia_Pruebas_Locales_AlertaFiscal.docx`.
- The PDF file.
- `session_checkpoint.md` — the current `.gitignore` does NOT exclude it, and it does not exclude the PDF either.

## 7. RUN THE BACKEND TESTS

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pytest
deactivate
cd ..
```

Expected result: **38 passed, 10 skipped** (using SQLite).

If anything fails, fix **ONLY** what was broken by the migration (paths to `ml/company_trainer` or `FORECAST_ARTIFACT_DIR`). Do not change the application logic.

## 8. BUILD THE FRONTEND

```powershell
cd frontend
npm ci
npm run build
cd ..
```

The build must finish without errors. The generated `dist/` directory must NOT be committed (it is already excluded by `.gitignore`).

## 9. CHECK THAT NO PROHIBITED FILES WILL BE COMMITTED

```powershell
git status
```

The list must NOT contain: `.env`, `.venv`, `node_modules`, `dist`, `dev.db`, `instance`, `ml/data/raw`, `.zip`, `.docx`, `.pdf`, or `session_checkpoint.md`.

If any of these appear, remove them from the folder or add them to `.gitignore` before proceeding.

## 10. COMMITS (BY DIRECTORY — NEVER USE `git add .`)

```powershell
git add backend/ frontend/
git commit -m "feat: port ERP backend and frontend"

git add ml/company_trainer/
git commit -m "feat: add per-company trainer from the ERP"

git add docs/erp/
git commit -m "docs: add ERP documentation"

git add render.yaml compose.yaml docker/ .github/ .env.docker.example
git commit -m "chore: add deployment and CI files"
```

(If `.env.docker.example` does not exist, leave it out of the `git add`.)

If you changed anything to make the tests pass:

```powershell
git add <files you changed>
git commit -m "fix: update paths after the ERP move"
```

Finally, push the branch:

```powershell
git push origin erp-port
```

All code comments and commit messages must be in English.

## 11. OPEN THE PULL REQUEST

On GitHub, go to **Pull requests > New pull request**.

- **Base:** `develop`
- **Compare:** `erp-port`
- **Title:** `Port the AlertaFiscal ERP`

In the description, include the test results (**38 passed, 10 skipped**) and confirm that the frontend builds successfully.

Request a review from Sergio. **Do not merge it yourself.**

## 12. SEPARATELY: REMOVE RAW DATA FROM `phase5/flask-api`

Commit `6cd63fc` (`feat: update Phase 5 implementation`) accidentally included the following files:

- `ml/data/raw/dian_monthly_collection_2000_2026.xlsx`
- `ml/data/raw/supersociedades_10000_companies.csv`

Committing files under `ml/data/raw` is prohibited. To remove them from Git without deleting your local copies, run the commands below.

**Warning:** while these files are tracked on `phase5/flask-api`, switching from that branch to any other branch makes Git delete your local copies of them. If you already have the files locally, copy them to a folder outside the repository first (for example `Copy-Item ml\data\raw\*.xlsx, ml\data\raw\*.csv C:\Users\<you>\Desktop\raw_backup\`), and copy them back after the last `git checkout`.

```powershell
git checkout phase5/flask-api
git pull origin phase5/flask-api
git rm --cached ml/data/raw/dian_monthly_collection_2000_2026.xlsx ml/data/raw/supersociedades_10000_companies.csv
git commit -m "chore: remove raw data from git"
git push origin phase5/flask-api
git checkout erp-port
```

After the `git rm --cached` commit, switching branches no longer deletes the local copies.

## WHEN EVERYTHING IS READY

Tell Sergio that the Pull Request is open. Then continue with steps 5 and 6 of Phase 5 (the traceability matrix and translation), followed by the `forecasting.py` changes using the placeholder model (due November 6).

Jonathan's actual model is already available in `phase3/modeling`. The instructions for loading it are in section 5.1 of `docs/phases/PHASE_5_INSTRUCTIONS.md` (on the `phase5/flask-api` branch).
# Módulo de Machine Learning (offline)

Este directorio es **independiente del servidor web**. El backend Flask no importa
scikit-learn ni ejecuta entrenamientos durante una petición. La app funciona sin este
módulo: la planificación manual es el modo por defecto.

## Qué hace

`train.py`:

1. Lee ingresos y gastos de la base de AlertaFiscal (PostgreSQL o SQLite de desarrollo).
2. Los agrega por mes y empresa, rellenando meses sin movimientos con cero.
3. Construye características: tendencia, tres rezagos y estacionalidad (seno/coseno del mes).
4. Evalúa con una **partición temporal** (los últimos meses son prueba, nunca aleatoria):
   - `seasonal_naive` (línea base: valor del mes anterior),
   - regresión lineal,
   - Random Forest.
5. Reporta MAE, RMSE y MAPE por modelo y elige el de menor MAE.
6. Reentrena el mejor modelo con toda la serie y proyecta `--horizon` meses de forma
   recursiva.
7. Guarda artefactos en `ml/artifacts/` (ignorado por git).

## Instalación

```powershell
# Desde la raíz del repositorio
python -m venv ml/company_trainer/.venv
ml\company_trainer\.venv\Scripts\Activate.ps1
pip install -r ml/company_trainer/requirements.txt
```

Python 3.11+ recomendado. El script usa las mismas variables de entorno que el backend
(`DATABASE_URL`, leída también desde `backend/.env`).

## Uso

```powershell
# Usa DATABASE_URL de backend/.env (PostgreSQL)
python ml/company_trainer/train.py

# Demo explícita con backend/instance/dev.db (sin DATABASE_URL)
$env:DB_MODE = "sqlite"
python ml/company_trainer/train.py

# Empresa concreta y horizonte de 6 meses
python ml/company_trainer/train.py --company-id 1 --horizon 6

# Contra PostgreSQL
python ml/company_trainer/train.py --database-url "postgresql+psycopg://usuario:clave@host:5432/alertafiscal"

# Salida personalizada
python ml/company_trainer/train.py --out ml/artifacts
```

Mínimo por defecto: 12 meses por empresa (`--min-months`). La semilla de demostración crea
18 meses, suficiente para entrenar y evaluar. Si no hay historial, el script lo dice y no
inventa datos.

## Artefactos

```
ml/artifacts/
├── metrics.json                          # métricas, proyecciones y metadatos
├── dataset_company1.csv                  # serie mensual usada
├── model_company1_income.joblib
└── model_company1_expenses.joblib
```

Ejemplo de `metrics.json`:

```json
{
  "generated_at": "2026-10-26T...",
  "horizon_months": 3,
  "companies": [
    {
      "company_id": 1,
      "months_available": 18,
      "targets": {
        "income": {
          "best_model": "random_forest",
          "metrics": {
            "seasonal_naive": {"mae": 0.0, "rmse": 0.0, "mape_percent": 0.0},
            "linear_regression": {"mae": 0.0, "rmse": 0.0, "mape_percent": 0.0},
            "random_forest": {"mae": 0.0, "rmse": 0.0, "mape_percent": 0.0}
          },
          "forecast": [{"month": "2026-11", "projected_income": 0.0}]
        }
      }
    }
  ],
  "disclaimer": "Proyecciones orientativas..."
}
```

Los valores del ejemplo son ilustrativos; ejecuta el script para obtener los reales.

## Límites y uso responsable

- Con 18 meses de datos sintéticos, las métricas miden el pipeline, **no** la capacidad
  predictiva sobre una empresa real.
- El MAPE es inestable cuando hay meses en cero; se reporta `null` si no hay valores
  distintos de cero.
- La proyección es recursiva: los errores se acumulan con el horizonte.
- **No** es una liquidación oficial de impuestos ni reemplaza al contador. El backend
  muestra siempre el aviso de estimación.
- No se guardan datos personales en los artefactos: solo series agregadas por empresa.

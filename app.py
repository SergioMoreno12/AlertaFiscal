"""
AlertaFiscal - Machine Learning Project
Flask App - Universidad de Cundinamarca - Systems and Computing Engineering
"""

from flask import Flask, render_template

app = Flask(__name__)

DATASETS = [
    {
        "nombre": "10.000 Empresas más Grandes del País",
        "fuente": "Superintendencia de Sociedades · Datos Abiertos Colombia",
        "url": "https://www.datos.gov.co/Comercio-Industria-y-Turismo/10-000-Empresas-mas-Grandes-del-Pa-s/6cat-2gcs",
        "formato": "CSV / API (Socrata)",
        "licencia": "CC BY-SA 4.0",
        "cobertura": "≈ 50.000 registros · cortes 2021 a 2025",
        "descripcion": (
            "Información financiera de las 10.000 empresas con mayores ingresos del país en cada año de corte. "
            "Los valores monetarios se reportan en billones de pesos."
        ),
        "variables": [
            "NIT", "Razón social", "Supervisor", "Región", "Departamento", "Ciudad", "CIIU",
            "Macrosector", "Ingresos operacionales", "Ganancia (pérdida)", "Total activos",
            "Total pasivos", "Total patrimonio", "Año de corte",
        ],
        "uso": (
            "Calcular razones financieras (margen neto, endeudamiento, rentabilidad) y sus distribuciones por "
            "macrosector, para generar empresas simuladas con perfiles financieros realistas."
        ),
    },
    {
        "nombre": "Estadísticas de Recaudo Mensual por Tipo de Impuesto 2000-2026",
        "fuente": "Dirección de Impuestos y Aduanas Nacionales (DIAN)",
        "url": "https://www.dian.gov.co/dian/cifras/Paginas/EstadisticasRecaudo.aspx",
        "formato": "Excel (.xlsx dentro de un .zip)",
        "licencia": "Información pública (Ley 1712 de 2014)",
        "cobertura": "Serie mensual · enero 2000 a agosto 2026",
        "descripcion": (
            "Recaudo bruto mensual administrado por la DIAN, en millones de pesos corrientes, desagregado por "
            "tipo de impuesto. En la misma página se publican las series anual y por seccionales."
        ),
        "variables": [
            "Año", "Mes", "Renta - cuotas", "Retención renta", "IVA - declaraciones", "Retención IVA",
            "G.M.F.", "Timbre", "Impuesto al consumo", "Impuesto unificado RST (Simple)", "Arancel",
            "IVA externo", "Total",
        ],
        "uso": (
            "Calibrar la proporción entre IVA y retenciones y la estacionalidad mensual de las obligaciones "
            "tributarias simuladas para cada pyme."
        ),
    },
]


# ---------- Descripción del proyecto ----------
@app.route("/")
def descripcion():
    return render_template("descripcion.html")


# ---------- Datasets ----------
@app.route("/datasets")
def datasets():
    return render_template("datasets.html", datasets=DATASETS)


if __name__ == "__main__":
    app.run(debug=True)

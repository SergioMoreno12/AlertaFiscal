"""
AlertaFiscal - Machine Learning Project
Flask App - Universidad de Cundinamarca - Systems and Computing Engineering
"""

from flask import Flask, render_template

app = Flask(__name__)

DATASETS = [
    {
        "nombre": "10,000 Largest Companies in the Country (10.000 Empresas más Grandes del País)",
        "fuente": "Superintendencia de Sociedades (Colombian Superintendency of Companies) · Colombia Open Data",
        "url": "https://www.datos.gov.co/Comercio-Industria-y-Turismo/10-000-Empresas-mas-Grandes-del-Pa-s/6cat-2gcs",
        "formato": "CSV / API (Socrata)",
        "licencia": "CC BY-SA 4.0",
        "cobertura": "≈ 50,000 records · annual cutoffs from 2021 to 2025",
        "descarga": "October 30, 2026",
        "descripcion": (
            "Financial information on the 10,000 highest-revenue companies in the country for each cutoff year. "
            "Monetary values are reported in trillions of Colombian pesos (Spanish \"billones\")."
        ),
        "variables": [
            "NIT (Tax ID)", "Company name", "Supervisor", "Region", "Department", "City",
            "CIIU (Industry code)", "Macrosector", "Operating revenue", "Profit (loss)",
            "Total assets", "Total liabilities", "Total equity", "Cutoff year",
        ],
        "uso": (
            "Build realistic company profiles: sector, net margin and annual growth, taken from real records "
            "or sampled from each sector's distributions, then rescaled to small-business size. It does not "
            "provide monthly figures, so the monthly income and expenses are simulated."
        ),
    },
    {
        "nombre": "Monthly Tax Collection Statistics by Type of Tax 2000-2026 (Estadísticas de Recaudo Mensual por Tipo de Impuesto 2000-2026)",
        "fuente": "Dirección de Impuestos y Aduanas Nacionales (DIAN, Colombian tax authority)",
        "url": "https://www.dian.gov.co/dian/cifras/Paginas/EstadisticasRecaudo.aspx",
        "formato": "Excel (.xlsx inside a .zip)",
        "licencia": "Public information (Law 1712 of 2014)",
        "cobertura": "Monthly series · January 2000 to August 2026",
        "descarga": "October 30, 2026",
        "descripcion": (
            "Gross monthly tax collection administered by the DIAN, in millions of current pesos, broken down by "
            "type of tax. The annual and regional-office series are published on the same page."
        ),
        "variables": [
            "Year", "Month", "Income tax - installments", "Income tax withholding", "VAT - returns",
            "VAT withholding", "Financial transactions tax (G.M.F.)", "Stamp tax", "Consumption tax",
            "Unified RST tax (Simple regime)", "Customs duty", "Imported VAT", "Total",
        ],
        "uso": (
            "Give the shape of the yearly seasonality (which months are higher or lower), smoothed over "
            "2-month windows because VAT is filed bimonthly. Its values are national totals and are never "
            "used as any company's figures."
        ),
    },
]


# ---------- Home ----------
@app.route("/")
def home():
    return render_template("index.html")


# ---------- Project Details ----------
@app.route("/descripcion")
def descripcion():
    return render_template("descripcion.html")


# ---------- Datasets ----------
@app.route("/datasets")
def datasets():
    return render_template("datasets.html", datasets=DATASETS)


if __name__ == "__main__":
    app.run(debug=True)

# AlertaFiscal

Machine Learning module that helps Colombian small businesses plan their tax burden by forecasting their monthly income and expenses for the next 6 months.
Project for the Machine Learning course, Universidad de Cundinamarca.

## Run locally

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000

## Deploy on Render

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`
- Live site: https://alertafiscal.onrender.com

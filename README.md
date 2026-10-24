# AlertaFiscal

Módulo de Machine Learning para la gestión preventiva del riesgo de cumplimiento tributario en pymes colombianas.
Proyecto de la asignatura Machine Learning, Universidad de Cundinamarca.

## Ejecutar localmente

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Abre http://127.0.0.1:5000

## Despliegue en Render

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`

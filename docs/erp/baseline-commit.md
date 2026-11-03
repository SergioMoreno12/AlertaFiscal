# Commit basal: estado, comprobaciones y autorización pendiente

Documento de registro del commit inicial local. **No hay remoto configurado y no se hizo
push.** La tabla siguiente conserva el estado previo a la creación del commit; después del
commit, `HEAD` existe y el árbol queda limpio salvo los dos documentos de usuario excluidos.

## 1. Estado previo a la creación del commit

| Comprobación | Resultado |
|---|---|
| `git rev-parse --verify HEAD` | Falla: el repositorio **no tiene commits** (rama sin nacer) |
| `git remote -v` | Vacío: **no hay remoto configurado** |
| `git status --short` | 82 entradas (archivos únicos) |
| Preparados (`git diff --cached`) | 64 archivos |
| Con cambios sin preparar (`git diff --name-only`) | 18 archivos |
| Sin rastrear (`git ls-files --others --exclude-standard`) | 27 archivos |

Los 18 archivos con cambios sin preparar son modificaciones posteriores a la preparación
inicial (por ejemplo `README.md`, `docs/sources.md`, `docs/decisions.md`,
`frontend/src/app/App.tsx`, `ml/train.py`). Los 27 sin rastrear incluyen el módulo de
contexto, la migración `f3b8c2d1a7e4`, los scripts y manifiestos de fuentes, las pruebas
nuevas, la documentación de fuentes y dos documentos de usuario.

Distribución de los 64 preparados: `backend/` 39, `frontend/` 14, `docs/` 4, `ml/` 3,
más `README.md`, `.gitignore`, `render.yaml` y `.github/workflows/ci.yml`.

## 2. Archivos que no deben versionarse

Verificado con `git check-ignore -v`:

| Ruta | Regla |
|---|---|
| `backend/.env` | `.gitignore:2` (`.env`) |
| `.env.docker` | `.gitignore:3` (`.env.*`) |
| `ml/data/` (crudos y procesados) | `.gitignore:42` |
| `frontend/node_modules/` | `.gitignore:31` |
| `backend/.venv/` | `.gitignore:13` |
| `backend/dev.db` y `*.db` | `.gitignore:23` |
| `frontend/dist/` | ignorado |

No hay bases de datos, crudos de DIAN/Supersociedades, entornos virtuales ni `node_modules`
entre los archivos preparados o sin rastrear.

## 3. Escaneo de secretos y archivos impropios

Se escanearon los 86 archivos de texto preparados o sin rastrear con estos patrones:

| Patrón | Coincidencias | Interpretación |
|---|---|---|
| `BEGIN (RSA\|OPENSSH\|EC\|PGP) PRIVATE KEY` | 0 | Sin claves privadas |
| `AKIA[0-9A-Z]{16}` | 0 | Sin claves AWS |
| `gh[pousr]_[A-Za-z0-9]{20,}` | 0 | Sin tokens de GitHub |
| `sk-[A-Za-z0-9]{20,}` | 0 | Sin claves de API tipo OpenAI |
| `xox[baprs]-...` | 0 | Sin tokens de Slack |
| `postgres(ql)?://usuario:clave@` | 2 | Credenciales **solo de CI/prueba** (ver abajo) |
| `password = "..."` | 1 | Contraseña demo documentada |
| `SECRET_KEY = "..."` | 0 | Sin secreto embebido |

Las tres coincidencias son esperadas y no son secretos reales:

- `.github/workflows/ci.yml:56` → `postgresql://alertafiscal:alertafiscal@localhost:5432/alertafiscal_ci`
  es el servicio efímero de PostgreSQL del propio workflow de CI.
- `backend/tests/test_config.py:112` → `postgresql://u:p@127.0.0.1:5432/db` es una URL
  ficticia usada para probar el parseo de configuración.
- `backend/app/seed.py:24` → `DEMO_PASSWORD = "demo2026"` es la credencial de demostración
  ya documentada en `README.md`; el seed solo se ejecuta manualmente.

No se encontraron archivos `.env` reales, `.pem`, `.key`, respaldos, capturas ni binarios
grandes entre los candidatos. Los únicos binarios sin rastrear son dos documentos de usuario
(ver punto 4).

## 4. Documentos de usuario sin rastrear

| Archivo | Tamaño | Recomendación |
|---|---|---|
| `Guia_Pruebas_Locales_AlertaFiscal.docx` | 42,1 KB | Decidir si forma parte del entregable; si no, dejar fuera |
| `Mapa de empatía — plantilla horizontal.pdf` | 1.655,6 KB | Material de diseño; probablemente fuera del repositorio de código |

Ninguno es necesario para ejecutar o probar el sistema. Se recomienda **no incluirlos** en el
commit basal salvo que el usuario indique lo contrario, para no mezclar material de
presentación con el código y evitar un PDF de 1,6 MB en el historial.

## 5. Contenido propuesto del commit basal

Un único commit inicial con todo el estado actual (aplicación, pruebas, migraciones,
documentación y etapa 2 limitada), excluyendo los dos documentos del punto 4:

```
chore: estado inicial de AlertaFiscal con contexto externo etiquetado

- ERP base: auth con sesión/CSRF, empresas, movimientos, planificación,
  seguimiento y alertas.
- Contexto externo de solo lectura (etapa 2 limitada): fuentes, versiones,
  agregados DIAN y benchmarks sectoriales; API autenticada y pantalla
  secundaria. No alimenta el pronóstico ni genera alertas.
- Migración f3b8c2d1a7e4 (solo tablas nuevas, con downgrade).
- Scripts offline de adquisición/procesamiento, manifiestos versionados,
  evidencia de licencias y validador reproducible.
- Pruebas: 30 pasan y 10 se omiten en SQLite; 40 pasan en PostgreSQL.
```

No se propone dividir en “basal” y “etapa 2” porque varios archivos preparados
(`backend/app/models.py`, `backend/app/__init__.py`, `frontend/src/app/App.tsx`,
`ml/train.py`, `README.md`) ya contienen cambios de ambas etapas; separarlos exigiría
reconstruir versiones intermedias y produciría un historial artificial.

## 6. Verificaciones ejecutadas antes de proponer el commit

| Verificación | Resultado |
|---|---|
| `npm run build` (`tsc --noEmit && vite build`) | Pasa; aviso de chunk > 500 kB, no bloqueante |
| `pytest` con SQLite temporal | 30 pasan, 10 omitidas por diseño |
| `pytest` con `TEST_DATABASE_URL` PostgreSQL | 40 pasan |
| `python -m ml.sources.validate` | Exit 0; 28.064 filas DIAN y 175 benchmarks coherentes con el manifiesto |
| Escaneo de secretos | Sin hallazgos reales (3 coincidencias justificadas) |
| `git check-ignore` | `.env`, `.env.docker`, `ml/data`, `node_modules`, `.venv`, `*.db` ignorados |

Los avisos `LF will be replaced by CRLF` de Git son normales en Windows y no alteran el
contenido lógico.

## 7. Autorización y estado

- [x] Migración `f3b8c2d1a7e4` aplicada **solo** en la base local de desarrollo `alertafiscal`
      (revisión final `f3b8c2d1a7e4`), con respaldo previo verificado.
- [x] Excluir del commit `Guia_Pruebas_Locales_AlertaFiscal.docx` y
      `Mapa de empatía — plantilla horizontal.pdf`, conservándolos en el equipo.
- [x] Commit inicial local creado (hash en `git log -1`); sin remoto ni push.
- [ ] Configurar remoto o hacer push: **no autorizado**.
- [ ] Renombrar la rama: **no autorizado**.
- [ ] Eliminar `alertafiscal_verify_test` o cualquier base/volumen: **no autorizado** en esta tarea.

# Fuentes externas de contexto

> **Aviso:** este documento describe datos públicos usados como **contexto agregado**.
> No son obligaciones tributarias de una empresa, no se unen por NIT con el ERP y no
> alimentan el pronóstico ni las alertas.

## 1. Principios

1. **Separación de dominios.** El ERP describe hechos de una empresa (ingresos, gastos,
   planes, reservas). Las fuentes externas describen agregados nacionales o sectoriales.
   Mezclarlas produciría comparaciones falsas.
2. **Sin unión por NIT.** No se cruza Supersociedades con empresas del ERP ni con DIAN.
   Tampoco se suman totales nacionales como si fueran observaciones independientes.
3. **Contexto, no etiqueta.** Ninguna cifra externa se usa como etiqueta de incumplimiento
   ni como variable de entrenamiento del modelo.
4. **Originales inmutables.** Los archivos crudos viven en `ml/data/raw/` (ignorado por git)
   y no se sobrescriben. Cada adquisición nueva se guarda en una carpeta con etiqueta de
   versión.
5. **Procesamiento reproducible.** Los derivados se generan con scripts versionados y se
   registran con hash, conteo y fecha en un manifiesto.
6. **Nada se descarga por petición.** La API solo lee lo que ya fue adquirido, procesado y
   cargado de forma explícita. El arranque de Flask no descarga, no entrena y no ejecuta
   semillas automáticas.

## 2. Supersociedades — 10.000 empresas más grandes

| Campo | Valor |
|---|---|
| Código interno | `supersociedades_top10000` |
| Dataset | `6cat-2gcs` (datos.gov.co / Socrata) |
| Publicador | Superintendencia de Sociedades (Supersociedades) |
| Atribución | Superintendencia de Sociedades SuperSociedades, Bogotá D.C. |
| Licencia | Creative Commons Attribution \| Share Alike 4.0 International (`CC_40_BY_SA`) |
| Términos | <http://creativecommons.org/licenses/by-sa/4.0/legalcode> |
| Evidencia | `docs/evidence/supersociedades-license.json` |
| Cadencia | Irregular, sin calendario fijo; no asumir frecuencia mensual |
| Cobertura | 2021–2025, 50.000 filas × 14 columnas |
| Granularidad | Una fila por empresa y año de corte |
| Unidades originales | **Billones de pesos (10¹² COP)**, no miles de millones |
| Adquisición | 2026-10-30T21:48:03Z |
| Última actualización de la fuente | 2026-09-16T20:29:04Z |
| Archivo | `ml/data/raw/supersociedades_10000_empresas.csv` (9.100.868 bytes) |
| SHA-256 | `5162638b205f752277cdc6c5965bf6d5169dc932d332288a188f95fbb59b017f` |
| Manifiesto | `ml/sources/manifests/supersociedades_top10000/20261030T214803Z.json` |

### Integridad de la descarga

Se verificó con **conteo + paginación estable** contra la API de Socrata:

- `count(*)` remoto: 50.000 filas.
- Filas locales: 50.000.
- Paginación: 10 páginas de 5.000, orden `nit,a_o_de_corte,raz_n_social`.
- Claves duplicadas en la paginación: 0.
- Hash de claves locales = hash de claves remotas:
  `366645ff4b4690747077a547425b0783bf633149be751ef501874a65037e1b94`.

La comprobación se repite con `python -m ml.sources.acquire supersociedades` (sin
`--download`), que no vuelve a descargar: compara el archivo local contra la fuente.

### Procesamiento

`python -m ml.sources.build_context supersociedades` genera
`ml/data/processed/supersociedades_top10000/20261030T214803Z/sector_benchmarks.csv`
(175 filas: 5 años × 5 métricas × 7 sectores, incluido `ALL`).

- Se conservan los dos decimales publicados; no se inventa precisión.
- Residuo de identidad contable `activos − pasivos − patrimonio`: máximo 0,01 billón,
  sin filas por encima de la tolerancia.
- Pares empresa-año duplicados: 0.
- Empresas distintas: 15.032.

### Limitaciones

- Es una muestra de las **10.000 empresas más grandes**, no un censo.
- Tiene sesgo de selección y de tamaño; no representa a las pymes.
- Los agregados por macrosector no describen a una empresa individual.
- La licencia exige atribución y compartir adaptaciones bajo la misma licencia.

## 3. DIAN — estadísticas de recaudo

| Campo | Valor |
|---|---|
| Código interno | `dian_recaudo` |
| Publicador | DIAN — Subdirección de Estudios Económicos |
| Página | <https://www.dian.gov.co/dian/cifras/Paginas/EstadisticasRecaudo.aspx> |
| Licencia | **No verificada en la fuente** (`uncertain`) |
| Evidencia | `docs/evidence/dian-license-uncertainty.md` |
| Cadencia | Mensual/irregular; las seccionales pueden publicarse después |
| Fecha de corte | 2026-10-23 |
| Unidades | **Millones de pesos corrientes** |
| Manifiesto | `ml/sources/manifests/dian_recaudo/20261030T214856Z.json` |

### Archivos originales

| Archivo | Cobertura | SHA-256 |
|---|---|---|
| `Recaudo-anual-por-tipo-de-impuesto-1970-2026.xlsx` | 57 años (1970–2026p) | `d47b15934af8cdef96a9c70e54d76544a3e463319c6b18e9d6211bd9384a7524` |
| `Recaudo-mensual-por-tipo-de-impuesto-2000-2026.xlsx` | 321 meses (2000–2026, 9 meses en 2026) | `68d5c296ba43554f7bb1f49fbebaddc6a1136c50c00cc6e65108de298804f0bd` |
| `Recaudo-bruto-por-seccionales-y-tipo-de-impuesto-2005-2026.xlsx` | 1.078 filas leídas: 1.056 seccionales + 22 filas de total (2005–2026p) | `d625f23dac232acd32fc4ea237d3f23842f8108d06a48a9fb4f1f8966b6dc58b` |

Los tres archivos están en `ml/data/raw/dian/` y **no se versionan ni se redistribuyen**
mientras la licencia siga sin verificar.

### Procesamiento

`python -m ml.sources.build_context dian` genera
`ml/data/processed/dian_recaudo/20261030T214856Z/tax_collection.csv` (28.064 filas,
SHA-256 `ca327290c99f2277f49e3405f731623815ffac0229e3087a0af940508a21f77a`).

- Se excluyen las 22 filas de total anual de la hoja seccional para no duplicar el
  recaudo. La fuente usa variantes: `TOTAL AÑO 2005`, `TOTAL_AÑO_2010` y, en 2026,
  `TOTA  AÑO 2026` (sin la L y con doble espacio). La detección normaliza acentos,
  separadores y espacios; no depende de una sola grafía.
- La serie 2026 se marca `is_preliminary=true` y es parcial (a septiembre).
- No se deflactan las cifras: son pesos corrientes.

### Conciliaciones

La fuente publica DIAN en **millones de COP** y Supersociedades en **billones (10¹²) COP**. El
procesado convierte a COP, pero esa conversión **no crea precisión**: las cifras se documentan
en su unidad original y la conversión se muestra solo como comodidad de lectura.

| Comparación | Diferencia en unidad original (millones COP) | Diferencia en COP | Tolerancia aplicada |
|---|---|---|---|
| Mensual vs anual 2010–2025 (máx.) | 0,00000007 | 0,07 | 0,10 COP |
| Seccional 2025 vs nacional 2025 | 0,0000001 | 0,10 | 0,10 COP |
| Seccional 2026 vs nacional 2026 | 0,00000001 | 0,01 | 0,10 COP |
| Seccional vs nacional 2013–2026 (peor año, 2017) | 4,42241398 | 4.422.413,98 | 50.000.000 COP |

- **Mensual vs anual (2010–2025):** la diferencia máxima es 0,07 COP. Ambas series se publican
  en millones con dos decimales; el residuo es redondeo de la fuente.
- **Seccional 2025 vs nacional 2025:** 294.462.356.991.440,00 vs 294.462.356.991.440,10 COP;
  diferencia 0,10 COP (0,0000001 millones).
- **Seccional 2026 vs nacional 2026:** 241.511.755.928.644,99 vs 241.511.755.928.645,00 COP;
  diferencia 0,01 COP. Esta comprobación detecta la duplicación de la fila de total.
- **2013–2026:** cada seccional se publica en millones enteros, así que la suma puede separarse
  del total nacional hasta 4.422.413,98 COP (2017). La tolerancia de 50.000.000 COP cubre el
  redondeo de 48 celdas y sigue siendo mucho menor que cualquier cifra relevante (el total 2026
  supera 2,4×10¹⁴ COP). No se interpreta como error de carga.
- **2005–2012:** la hoja seccional no cubre todo el recaudo nacional; la diferencia no se
  trata como error de carga y esos años no se usan para la conciliación seccional-nacional.

La validación reproducible es `python -m ml.sources.validate`. Comprueba que no haya filas
de total tratadas como seccionales, que no haya claves duplicadas, que los cuantiles estén
ordenados y que los hashes/conteos coincidan con el manifiesto.

Estas conciliaciones validan la lectura de los archivos; **no** convierten el recaudo en una
obligación de una empresa. Los importes mostrados en COP no deben presentarse como precisión
original al centavo: la resolución real es la de la fuente (millones o billones).

### Limitaciones

- El recaudo agregado no dice cuánto debe o pagó una empresa.
- 2026 es parcial y preliminar; no debe compararse como año completo.
- Antes de 2013 la hoja seccional no cubre todo el recaudo nacional; no se usa para
  conciliar contra el total nacional.
- Los nombres de seccionales conservan la grafía de la fuente y tienen variantes; no se
  normalizan para no alterar el original.
- No hay vintages históricos de las publicaciones: solo se conserva la copia adquirida.
- Sin licencia verificada, no se afirma prohibición legal ni autorización: se adopta una
  postura conservadora de no redistribución.

## 4. Reproducción

Desde la raíz del repositorio:

```powershell
# 1) Adquisición / verificación (red solo en este paso)
ml/.venv/Scripts/python.exe -m ml.sources.acquire supersociedades
ml/.venv/Scripts/python.exe -m ml.sources.acquire dian

# 2) Procesamiento offline a CSV de contexto
ml/.venv/Scripts/python.exe -m ml.sources.build_context all

# 3) Carga idempotente en PostgreSQL (no crea alertas)
cd backend
.venv/Scripts/python.exe -m flask context-load ..\ml\sources\manifests\supersociedades_top10000\20261030T214803Z.json
.venv/Scripts/python.exe -m flask context-load ..\ml\sources\manifests\dian_recaudo\20261030T214856Z.json
```

`context-load` acepta `--dry-run` (valida sin escribir) y `--replace` (recarga los agregados
de una versión). Sin `--replace`, una segunda carga del mismo manifiesto devuelve `skipped`.

## 5. Versionado y fallos

- **Fuente lógica vs versión de adquisición.** `external_sources` describe la fuente
  (publicador, licencia, cadencia). `external_dataset_versions` describe cada adquisición.
- **Identidad por contenido.** La identidad es `identity_sha256`, no la etiqueta de fecha.
  Dos descargas con el mismo nombre pero distinto contenido se conservan como versiones
  distintas.
- **Una sola vigente.** Un índice único parcial garantiza una versión `is_current` por
  fuente. Las anteriores no se borran.
- **Fallo de fuente.** Si la descarga o verificación falla, el comando termina con estado
  `blocked`, se conserva la última versión válida y se solicita el original. No se rellenan
  huecos con datos inventados ni se presenta una estimación como descarga.

## 6. Lo que esta etapa no hace

- No modifica el motor de alertas, reservas ni obligaciones.
- No usa las fuentes para entrenar ni para generar etiquetas.
- No crea alertas ni tareas del contador a partir del contexto.
- No expone escritura: la API de contexto es de solo lectura.

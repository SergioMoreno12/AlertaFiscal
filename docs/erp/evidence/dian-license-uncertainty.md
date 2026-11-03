# DIAN: estado de licencia y condiciones de uso

**Fecha de revisión:** 2026-10-30T22:10:39Z
**Fuente:** https://www.dian.gov.co/dian/cifras/Paginas/EstadisticasRecaudo.aspx
**Estado:** incertidumbre de licencia (no verificada en la fuente)

## Qué se observó

La página de estadísticas de recaudo de la DIAN no declara, en el HTML
consultado, una licencia de reutilización explícita. Los archivos se publican
como información pública y las hojas incluyen la leyenda "El contenido de este
documento corresponde a información pública", pero esa leyenda no equivale por
sí sola a una licencia de redistribución.

## Decisión operativa (no es una conclusión legal)

- Los archivos crudos **no se publican ni se versionan en git**.
- No se redistribuyen fuera del repositorio local.
- Se usan únicamente como contexto agregado, con atribución a la DIAN.
- No se afirma que exista una prohibición legal: solo que la licencia no está
  verificada y que falta autorización explícita para redistribuir.
- Antes de publicar derivados o crudos, se debe revisar la fuente o pedir
  autorización a la DIAN.

## Evidencia de archivos (originales locales, fuera de git)

| Archivo | SHA-256 | Bytes |
|---|---|---|
| `Recaudo-anual-por-tipo-de-impuesto-1970-2026.xlsx` | `d47b15934af8cdef96a9c70e54d76544a3e463319c6b18e9d6211bd9384a7524` | 45441 |
| `Recaudo-mensual-por-tipo-de-impuesto-2000-2026.xlsx` | `68d5c296ba43554f7bb1f49fbebaddc6a1136c50c00cc6e65108de298804f0bd` | 147708 |
| `Recaudo-bruto-por-seccionales-y-tipo-de-impuesto-2005-2026.xlsx` | `d625f23dac232acd32fc4ea237d3f23842f8108d06a48a9fb4f1f8966b6dc58b` | 217105 |

## Cifras y unidades

- Millones de pesos corrientes.
- Corte declarado: 2026-10-23.
- 2026 es parcial y preliminar; no se compara como año completo.

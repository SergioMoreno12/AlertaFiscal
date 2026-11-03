# Decisiones de diseño — etapa 2 limitada

Registro de decisiones con su contexto, la alternativa descartada y el estado real. Las
decisiones marcadas **diferidas** no están implementadas y no deben presentarse como hechas.

## D1. El contexto externo es contexto, no etiqueta ni predictor

**Contexto.** Se dispone de recaudo DIAN y de agregados de Supersociedades.

**Decisión.** Se incorporan como información de referencia etiquetada. No entrenan el
modelo, no son etiquetas de incumplimiento y no generan alertas ni tareas.

**Por qué.** El recaudo nacional no dice qué debía pagar una empresa; los agregados
sectoriales de las 10.000 empresas más grandes no representan a una pyme. Usarlos como
predictores introduciría fuga de información y comparaciones inválidas.

**Estado.** Implementado: la API y la pantalla muestran un aviso explícito y el cargador
no toca la tabla de alertas.

## D2. Sin unión por NIT y sin unir fuentes artificialmente

**Contexto.** Ambas fuentes tienen NIT o identificadores, pero con propósitos distintos.

**Decisión.** No se hace join por NIT con empresas del ERP ni entre fuentes. No se suman
totales nacionales como si fueran observaciones independientes.

**Por qué.** Un mismo NIT puede aparecer con variantes, y la cobertura de cada fuente es
distinta. Un join produciría falsos positivos y duplicaría conteos.

**Estado.** Implementado: el esquema no tiene clave foránea a `companies` y los agregados
se guardan por año/métrica/sector o por período/serie.

## D3. Persistir agregados, no una tabla por empresa

**Decisión.** Se guardan `tax_collections` y `sector_benchmarks`. No se crea una tabla de
“contexto por empresa”.

**Por qué.** El uso previsto es comparar magnitudes agregadas, no afirmar hechos
individuales. Una tabla por empresa invitaría a un join indebido.

**Estado.** Implementado.

## D4. Fuente lógica separada de versión de adquisición

**Contexto.** Una fuente se actualiza varias veces y puede cambiar sin aviso.

**Decisión.** `external_sources` describe la fuente; `external_dataset_versions` describe
cada adquisición. La identidad es el hash del contenido, no la etiqueta de fecha. Se admite
más de una descarga y solo una versión vigente por fuente mediante un índice único parcial.

**Por qué.** Sobrescribir la versión anterior impediría auditar qué se sabía en cada
momento. La etiqueta de fecha puede repetirse si dos descargas ocurren en el mismo segundo.

**Estado.** Implementado: `uq_external_version_current (source_id) WHERE is_current`.

## D5. Adquisición offline y carga explícita

**Decisión.** La red solo se usa al ejecutar `ml.sources.acquire`. El procesamiento y la
carga son offline. Flask no descarga, no entrena al arrancar, no ejecuta semillas
automáticas y la API nunca sale a internet.

**Por qué.** Reproducibilidad, auditabilidad y arranque predecible. También evita que una
caída de la fuente bloquee la aplicación.

**Estado.** Implementado.

## D6. Licencias: evidencia y prudencia

**Contexto.** Supersociedades declara CC BY-SA 4.0. La DIAN no declara una licencia de
reutilización explícita en la página consultada.

**Decisión.** Se guarda evidencia de la licencia de Supersociedades
(`docs/evidence/supersociedades-license.json`) y se registra la incertidumbre de DIAN
(`docs/evidence/dian-license-uncertainty.md`) con estado `uncertain`. Los crudos no se
versionan ni se redistribuyen. No se afirma que exista una prohibición legal.

**Por qué.** La leyenda “información pública” no equivale por sí sola a una licencia de
redistribución. La postura conservadora evita un uso indebido sin inventar una conclusión
jurídica.

**Estado.** Implementado. Antes de publicar derivados de DIAN se debe revisar la fuente o
pedir autorización.

## D7. Reservas y versionado de planes

**Contexto.** `FiscalPlanVersion.estimated_reserve` es una **meta** del plan. `ReserveEntry`
es una **reserva registrada**, con `plan_version_id` opcional. Versionar un plan crea una
versión nueva y no reescribe la anterior.

**Decisión.** Se mantiene la separación entre meta de reserva y reserva registrada. La
reserva conserva la referencia a la versión con la que se registró; versionar no la pierde
ni la duplica. No se cambia todavía la cobertura para sumar solo reservas de la versión
vigente.

**Por qué.** Cambiar la cobertura sin una política explícita haría que una reserva
histórica desapareciera del indicador o se contara dos veces. Primero debe definirse cómo
se conserva una reserva al versionar y cómo se distingue “reservado” de “asignado al plan”.

**Estado.** Comportamiento actual probado en `backend/tests/test_context.py`
(`test_versioning_plan_does_not_lose_or_duplicate_reserves`). La nueva política de cobertura
está **diferida**.

## D8. Proyección desactualizada

**Contexto.** Una proyección depende de las entradas usadas al generarla. Cambiar una
reserva o revisar una alerta no cambia los ingresos ni los gastos históricos.

**Decisión.** La proyección debe guardar las entradas reales y una revisión/hash de esas
entradas. Los cambios de reservas o de revisión de alertas **no** deben invalidarla
automáticamente. Solo un cambio en las entradas del pronóstico justifica marcarla
desactualizada.

**Por qué.** Invalidar por cambios no relacionados obligaría a recalcular sin motivo y
ocultaría la diferencia entre “dato de entrada cambió” y “otra parte del plan cambió”.

**Estado.** **Diferida.** En esta etapa no se modifica el módulo de proyecciones ni se
añade el hash de entradas.

## D9. Ciclo de vida de alertas y contexto informativo

**Contexto.** Las alertas actuales no tienen `code`, `period`, recurso, `resolved_at` ni
deduplicación. `TaxObligation` solo tiene un `status`, sin separar presentación, pago y
revisión.

**Decisión.** El contexto informativo no crea por defecto alertas pendientes ni tareas del
contador. Primero deben implementarse reglas accionables y definir revisión, resolución,
descarte, condición activa y reaparición. Un descarte justificado no se reabre sin una
política explícita. La auditoría se conserva.

**Por qué.** Generar alertas a partir de cifras nacionales produciría ruido y falsos
positivos; además, sin deduplicación se repetirían en cada carga.

**Estado.** **Diferida.** El cargador de contexto registra auditoría (`context.load`,
`context.record`) pero no crea alertas.

## D10. Protocolo de ML y datos

**Contexto.** El baseline usa 18 meses de una empresa; la segunda empresa tiene un mes y se
omite con `--min-months 12`.

**Decisión.** No se afirma que 24–36 meses garanticen validez universal de una MLP. Se
documenta el origen real o simulado de los datos, los ejemplos efectivos, los rezagos, el
horizonte, las ventanas y la complejidad. Las métricas ya reportadas se explican con su
protocolo (empresa, meses, horizonte, método y MAE).

**Por qué.** El desempeño depende de la serie, la estacionalidad y el horizonte; un número
de meses no es una garantía. Con pocos datos, una MLP no es defendible como modelo
empresarial.

**Estado.** Documentado; el experimento MLP sigue siendo académico y **no** valida uso
empresarial.

## D11. Git y commit basal

**Decisión.** No se hace commit, push ni despliegue sin autorización explícita. La ausencia
de commit no es una vulnerabilidad del ERP: es un estado de preparación.

**Estado.** Pendiente de autorización. Ver `docs/baseline-commit.md`.

## D12. PostgreSQL como base de validación

**Decisión.** Las pruebas de integración se ejecutan contra PostgreSQL. SQLite se usa solo
para pruebas rápidas y demo, nunca para afirmar que la integración está validada.

**Estado.** Implementado: 40 pruebas en PostgreSQL, 30 en SQLite (10 omitidas por diseño).

## D13. Detección robusta de filas de total en la hoja seccional

**Contexto.** Durante la verificación visual, la tarjeta “Seccionales 2026” mostró
483.023.511.857.290 COP, exactamente el doble del total nacional 2026. La causa era una fila
`TOTA  AÑO 2026` (sin la L y con doble espacio) que el filtro `startswith("TOTAL")` no
detectaba y que se sumaba como si fuera una seccional. La hoja también usa `TOTAL_AÑO_2010`.

**Decisión.** Normalizar acentos, separadores y espacios antes de comparar, y validar los
procesados con `python -m ml.sources.validate`. La validación comprueba que ninguna fila de
total quede como seccional y que la suma seccional coincida con el total nacional en los
años comparables.

**Por qué.** Un filtro por prefijo literal es frágil frente a erratas y variantes de la
fuente. La comprobación visual por sí sola no habría detectado el problema sin mirar la
cifra; la validación automática lo habría hecho.

**Estado.** Implementado. El CSV pasó de 28.088 a 28.064 filas y la conciliación 2026 quedó
en 0,01 COP. La comparación seccional-nacional solo se exige desde 2013, porque antes la
hoja no cubre todo el recaudo nacional.


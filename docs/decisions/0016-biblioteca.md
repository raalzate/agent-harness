# ADR 0016 — La documentación se indexa por tipo y se ubica por concepto

- **Fecha:** 2026-11-05
- **Estado:** aceptado
- **Relacionado:** [0005](0005-indice-obligatorio.md) (el índice del código), [0002](0002-sin-dependencias.md) (sin dependencias), [0004](0004-contrato-de-hooks.md) (fallar abierto)

## Contexto

El código tiene índice (codegraph, ADR 0005); la documentación no. Para contestar «qué dice la doc
sobre X» el agente abría archivos enteros, y lo que no encontraba lo contestaba de memoria. Además
la documentación mezcla tres cosas que se leen distinto: relaciones (quién depende de quién), datos
puntuales (una clave, un rol, un umbral) y explicaciones. Una búsqueda de texto las trata igual y
devuelve un párrafo donde hacía falta una fila.

## Decisión

- **Tres tipos, reconocidos por forma y no por carpeta:** grafo (JSON con `nodes`/`edges`), tabla
  (markdown que es sólo tablas) y documento (el resto). Los dos primeros son información
  estructurada y se consultan por nodo o por fila; el tercero, por sección.
- **Bases de conocimiento como conceptos delimitados:** cada base declara `concept` y `scope`, y
  cada archivo vive en exactamente una. La superposición es rojo: es la única forma mecánica de
  decir «este concepto no está delimitado».
- **Bases lógicas o físicas.** `include` (globs) agrupa sin mover; `dir` mueve con `migrate --apply`,
  que reescribe los enlaces. Este repo usa bases lógicas: sus docs se citan por ruta en el código y
  en el config, y mover 40 archivos es un cambio propio que decide el humano.
- **Índice generado y verificado por el gate.** `library.catalog` (máquina) y `library.appendix`
  (humano) los escribe sólo `index`; la señal `library index (docs)` compara contra lo que se
  generaría hoy. El catálogo guarda sólo lo que cambia con el sentido (títulos, resumen, secciones,
  columnas), no líneas ni hashes: si no, cada typo corregido dejaría el gate rojo (P3).
- **El consultor es un subagente con contrato.** `librarian` cierra con `COBERTURA:`, y
  `subagent-contract` lo hace cumplir: una respuesta sin fuente es una opinión.
- **Sin dependencias.** El ranking es por términos (sin tildes, sin `stopwords`, raíz liviana), no
  semántico. La comprensión la pone el subagente al leer lo que el índice señaló.

## Consecuencias

- Editar el título o el primer párrafo de un documento exige re-indexar (`library-index`). Es el
  costo de que el índice no mienta.
- Un doc nuevo bajo `docs/` sin base pone el gate en rojo hasta que alguien decida su concepto.
- El ranking no encuentra sinónimos que nadie declaró. `library.query.synonyms` (grupos de
  palabras de un mismo concepto) y `library.query.boosts` (la forma de la pregunta elige la base)
  son la mitigación declarada; un índice semántico necesitaría una dependencia.
- Al portar, la plantilla trae `library` sin bases y sin la señal: primero se migra, después se
  enciende la señal. Encenderla antes sería un gate rojo de nacimiento.

# La biblioteca: la documentación indexada y el bibliotecario

El agente lee la documentación como lee el código sin índice: abre diez archivos para encontrar
una fila de una tabla, y lo que no encuentra lo contesta de memoria. La biblioteca es el índice de
la documentación, y el subagente `librarian` es quien la consulta.

## Qué es

`node scripts/library.mjs` recorre la raíz declarada en `library.root` (en este repo, `docs/`) y
clasifica cada archivo en **uno de tres tipos**:

| Tipo | Forma | Información | Para qué pregunta sirve |
|---|---|---|---|
| **grafo** | JSON con `nodes` (cada uno con `id` único; `label` y `type` opcionales) y `edges` (`from` → `to`, a ids declarados) | estructurada | «qué depende de X», «qué viene después de Y» |
| **tabla** | markdown con **sólo** títulos y tablas: una línea de prosa lo vuelve documento | estructurada | «qué valor / rol / umbral tiene X» |
| **documento** | cualquier otro markdown | no estructurada | «por qué», «cómo funciona», «qué se decidió» |

El orden de clasificación es ese: grafo, después tabla, después documento. Los nombres de las
claves del grafo y las extensiones de cada tipo salen de `library.kinds`.

Cada entrada vive en **una sola base de conocimiento**. Una base es un concepto delimitado:
`concept` dice qué es, `scope` qué NO entra y a dónde va. Que dos bases reclamen el mismo archivo
es la prueba mecánica de que dos conceptos se pisan, y el `check` lo rechaza.

Las bases de este repo, su concepto y sus entradas están en el apéndice: [INDICE.md](INDICE.md).
La información estructurada de este repo: una tabla, [quien-lee-cada-clave.md](quien-lee-cada-clave.md)
(cada clave del config y quién la lee), y un grafo, [mapa-del-arnes.json](mapa-del-arnes.json) (cada
etapa del ciclo y las guías, frenos y sensores que actúan en ella). El grafo es **generado**
(`node scripts/harness-map.mjs --graph`) y el self-test lo compara con el mapa de hoy.

## Dos índices, uno por lector

| Archivo | Para quién | Qué tiene |
|---|---|---|
| `library.appendix` ([INDICE.md](INDICE.md)) | el humano | las bases con su concepto y su límite, y cada entrada con su tipo y su resumen |
| `library.catalog` (`.claude/library/catalog.json`) | el `librarian` | lo mismo en JSON, más los títulos de sección, las columnas de cada tabla y los tipos de nodo |

Los dos son **generados**. El catálogo guarda sólo lo que cambia cuando cambia el *sentido* (título,
primer párrafo, secciones, columnas): corregir un typo en un párrafo no deja el índice viejo; cambiar
un título sí.

## Los comandos

```bash
node scripts/library.mjs index                         # re-indexar: escribe catálogo y apéndice
node scripts/library.mjs check                         # la señal del gate
node scripts/library.mjs query "<tema>" --kind table   # ranking, cada resultado con DÓNDE casó
node scripts/library.mjs lookup <ruta> --where rol=pagos         # una tabla, por fila
node scripts/library.mjs lookup <ruta> --node cobro --depth 2    # un grafo, por vecindad
node scripts/library.mjs lookup <ruta> --section "Consecuencias" # un documento, por sección
node scripts/library.mjs migrate                       # dry-run: qué va a qué base
```

`query` busca sin distinguir mayúsculas ni tildes, ignora `library.query.stopwords`, expande cada
término con su grupo de `library.query.synonyms` («despliegue» casa «deploy»), suma los `boosts`
de la base que corresponde a la forma de la pregunta («qué se decidió» → `diseno`) y da puntos
por título, resumen, secciones, concepto de la base, columnas y tipos de nodo; después lee cada
candidato y devuelve la sección, la fila o el nodo donde casó, con `ruta:línea` o `ruta#nodo`.

## Cómo se llama al bibliotecario

La guía está en tres lugares:

- **El ruteo.** La ruta `library` de `sdd.routes`: un pedido como «qué dice la documentación sobre
  X», «dónde está documentado Y», «qué se decidió sobre Z» o «indexá la doc» le pone delante al
  agente que delegue en `librarian`.
- **El subagente.** `.claude/agents/librarian.md`: clasifica el pedido (dato puntual → tabla,
  relación → grafo, explicación → documento, panorama → apéndice), consulta el índice, lee sólo lo
  señalado y contesta con `RESPUESTA`, `FUENTES`, `NO ENCONTRADO` y `COBERTURA`.
- **El contrato.** `subagentOutput.contracts.librarian`: si la respuesta no cierra con
  `COBERTURA: COMPLETA | PARCIAL | SIN RESULTADOS`, el hook `SubagentStop` le devuelve el turno. Una
  respuesta sin cobertura declarada no distingue lo citado de lo recordado.

Sus dos skills: **`library-index`** (indexar y re-indexar, leyendo antes cada `✗` del `check`) y
**`library-migrate`** (ubicar en bases, separar tablas y grafos de la prosa, mover).

## La frontera con el `explorer`: la fuente, no la pregunta

«¿Dónde está X?» puede ser una pregunta sobre código o sobre documentación, así que la forma de la
pregunta no sirve de frontera. La frontera es **la fuente**:

| Subagente | Su fuente | Su índice |
|---|---|---|
| `explorer` | el código (fuentes, config) | codegraph (`graph`) |
| `librarian` | lo que vive bajo `library.root` | la biblioteca (`library`) |

- Cada uno tiene en su `.md` la línea «no es mío → el otro agente», y la `description` del
  `explorer` excluye la documentación.
- El hook `graph-first` nombra al `librarian` (`library.agent`) para la documentación cuando
  empuja al índice del código.
- Una pregunta **mixta** —casa `graph.questionPatterns` y la ruta de `library.route`— pide los dos
  subagentes **en paralelo**, en el mismo mensaje: lo dice `graph-first` y lo dice el mensaje de la
  ruta `library` (que habla aunque no haya grafo construido). Cada uno contesta su parte; el agente
  principal cruza las dos.

## Migrar a la estructura

Una base puede ser **lógica** (`include`: globs de lo que contiene, los archivos no se mueven) o
**física** (`dir`: sus archivos viven bajo `<root>/<dir>/`). Este repo usa bases lógicas: sus docs
están citados por ruta en el código, en `CLAUDE.md` y en el config, y moverlos es un cambio propio.

`migrate` sin flags es un dry-run (P9) con tres tipos de paso: `shelve` (sin base, o con dos: sugiere
una por `keywords`), `move` (base física, archivo fuera de su carpeta) y `skip` (ruta protegida o
destino existente: nunca se sobreescribe). `--apply` exige el árbol limpio, mueve, reescribe en todo
archivo versionado los enlaces relativos y las rutas citadas en prosa, y re-indexa.

## Qué verifica el gate

La señal `library index (docs)` (`node scripts/library.mjs check`) sale roja cuando:

- el catálogo o el apéndice no coinciden con lo que se generaría hoy (**índice viejo**);
- un archivo no está en ninguna base, o está en dos;
- una base está vacía, repetida o sin `concept`;
- un JSON bajo la raíz no tiene forma de grafo (y no está en `library.ignore`), o un grafo tiene
  un nodo sin `id`, un `id` repetido o una arista hacia un nodo que no existe.

Sin la clave `library` el script dice «skipped» y sale con 0: un arnés sin configurar no bloquea a
nadie (P5). La prueba de vida está en la sección 12 del self-test.

## Qué NO hace

- No entiende el contenido: el ranking es por términos, no semántico; los sinónimos son los que
  alguien declaró. La comprensión la pone el
  `librarian` al leer lo señalado; el índice sólo evita que lea de más.
- No decide las bases: las sugiere. Un concepto bien delimitado lo escribe una persona.
- No convierte prosa en tablas ni en grafos: eso lo propone el skill `library-migrate`, y lo
  aprueba el humano.

El porqué del diseño: [ADR 0016](decisions/0016-biblioteca.md).

---
name: library-index
description: Indexa o re-indexa la biblioteca de documentación (grafos, tablas y documentos agrupados en bases de conocimiento) y deja el catálogo y el apéndice en sincronía. Úsalo cuando se agregó, movió o retituló un documento, cuando la señal del gate `library index (docs)` sale roja por índice viejo, o cuando alguien pide "indexá la documentación".
---

# Indexar la biblioteca

El índice es infraestructura de lectura: el `librarian` contesta con lo que el índice dice. Un
índice viejo miente, y miente sobre el mapa con el que se decide qué leer. Por eso el gate lo
verifica y este skill es la única forma de escribirlo.

## 1. Mirá antes de escribir

```bash
node scripts/library.mjs check
```

Leé cada `✗`. Hay tres familias y cada una se arregla distinto:

| Lo que dice | Qué significa | Qué hacer |
|---|---|---|
| `stale index` | un documento cambió de título, resumen o secciones y el índice no | re-indexar (paso 2) |
| `on no shelf` / `on two shelves` | un archivo no está en ninguna base, o en dos | **no** se arregla indexando: es una migración → skill `library-migrate` |
| `unclassified` / `broken graph` | un JSON sin forma de grafo, o una arista que apunta a un nodo que no existe | arreglar el archivo (o, si no es biblioteca, sumarlo a `library.ignore`) |

## 2. Re-indexá

```bash
node scripts/library.mjs index
```

Escribe `library.catalog` (máquina) y `library.appendix` (humano). Sale con 1 si quedan problemas
que el `check` va a rechazar: el índice se escribe igual —para poder mirarlo— pero **no está
terminado** hasta que el `check` salga verde.

Nunca edites el catálogo ni el apéndice a mano: el próximo `check` los compara contra lo que se
genera, y la edición a mano se ve como índice viejo.

## 3. Verificá

```bash
node scripts/library.mjs check
npm run gate
```

El `check` verde es la prueba de que el índice dice lo que los documentos dicen. El gate verde
es el entregable (P1): un apéndice nuevo cambia enlaces, y el link-check los mide.

## Reglas de formato (lo que el índice reconoce)

- **Grafo:** JSON con un arreglo `nodes` (cada nodo con `id` único; `label` y `type` opcionales)
  y `edges` (`from`/`to` que apuntan a ids declarados). `title` y `description` en la raíz
  alimentan el apéndice. Los nombres de esas claves salen de `library.kinds.graph`.
- **Tabla:** un markdown que tiene **sólo** títulos y tablas. Una línea de prosa lo convierte en
  documento: si la explicación importa, va en un documento aparte que enlaza a la tabla.
- **Documento:** cualquier otro markdown. El primer `#` es el título y el primer párrafo, el
  resumen: escribilos pensando en que es lo que se lee en el apéndice.

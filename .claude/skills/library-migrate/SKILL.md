---
name: library-migrate
description: Migra documentación a la estructura de la biblioteca — ubica cada archivo en una sola base de conocimiento, propone bases nuevas cuando ningún concepto lo cubre, separa tablas y grafos de la prosa, y mueve los archivos de las bases físicas reescribiendo los enlaces. Dry-run primero, siempre. Úsalo al instalar la biblioteca en un repo con docs existentes, cuando el check dice "on no shelf" o "on two shelves", o cuando alguien pide "ordená la documentación".
---

# Migrar a la biblioteca

Migrar es una acción en lote sobre archivos que otros enlazan: P9 manda. **Dry-run, lista,
confirmación del humano, después ejecutar** — y desde un árbol limpio, para que todo se deshaga
con git.

## 1. El plan, sin tocar nada

```bash
node scripts/library.mjs migrate
```

Tres tipos de paso:

- `shelve` — el archivo no está en ninguna base (o está en dos). El script **sugiere** una base
  por palabras clave; la sugerencia es un punto de partida, no la decisión.
- `move` — el archivo es de una base con `dir` (física) y vive fuera de `<root>/<dir>/`.
- `skip` — ruta protegida (P8: la mueve el humano, en su propio commit) o destino ya existente
  (nunca se sobreescribe).

## 2. Las bases: conceptos bien delimitados

Antes de ubicar un archivo, mirá si su base existe. Una base nueva en `library.bases` lleva:

| Clave | Qué es | La prueba |
|---|---|---|
| `id` | nombre corto, en minúsculas | es el ancla del apéndice |
| `concept` | **qué es** el concepto, en una línea | ¿alguien que no conoce el repo sabe qué va adentro? |
| `scope` | **qué NO entra**, y a qué base va | si no podés escribirlo, el concepto no está delimitado |
| `keywords` | palabras con las que se pregunta por el concepto | las usa la sugerencia de `shelve` y el ranking de `query` |
| `include` | globs de lo que contiene (base lógica) | `*` un segmento, `**` cualquiera |
| `dir` | carpeta bajo `library.root` (base física, opcional) | `migrate --apply` mueve ahí |

Un archivo que encaja en dos bases es la señal de que dos conceptos se pisan: se corrige el
`scope`, no se duplica el archivo. El `check` rechaza un archivo en dos bases y una base vacía.

La config se edita **con el editor**, no con heredoc del shell (`docs/gotchas.md`).

## 3. Separar lo estructurado de lo no estructurado

La migración no es sólo mover. Al revisar cada documento, preguntá:

- **¿Hay una tabla que se consulta por fila** (claves, roles, umbrales, equivalencias) metida en
  medio de la prosa? → va a su propio archivo de tipo tabla (sólo títulos y tablas), y el
  documento la enlaza. Así el `librarian` la contesta con una fila, no con una interpretación.
- **¿Hay relaciones** (dependencias, flujos, quién llama a quién) descritas en párrafos o en un
  diagrama dibujado? → un grafo JSON (`nodes` + `edges`), y el documento lo enlaza.
- Lo demás queda como documento: título con `#`, primer párrafo que sirva de resumen.

Esto **cambia contenido**: proponelo como lista y esperá el sí antes de escribirlo.

## 4. Ejecutar (sólo con el sí del humano)

```bash
git status --short                          # tiene que salir vacío: --apply lo exige
node scripts/library.mjs migrate --apply    # mueve, reescribe enlaces, re-indexa
node scripts/library.mjs check
npm run gate
```

`--apply` mueve los archivos de las bases físicas, reescribe en todo archivo versionado los
enlaces relativos y las rutas citadas en prosa, y re-indexa. Si algo sale mal, todo vuelve con
`git restore` y `git clean` sobre las rutas movidas: por eso exige el árbol limpio.

El gate verde es el final (P1): el link-check mide cada enlace contra `git ls-files`, así que los
archivos movidos se agregan por nombre antes de correrlo.

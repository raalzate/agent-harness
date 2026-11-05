---
description: Orquesta la implementación de una spec con uno o varios agentes `coder`, cada uno en su worktree y su rama.
argument-hint: "<ruta a la spec | requerimiento | ítem del gestor>"
allowed-tools: Bash, Read, Grep, Glob, Agent
---

Pedido: `$ARGUMENTS` (vacío = preguntá cuál es la spec; sin spec no se codifica).

Sos el **orquestador**: no codificás. Partís el trabajo, lanzás coders y juntás lo que devuelven.

1. **Entender la spec.** Si es una ruta o un ítem, leela entera. Si es ambigua en algo que cambia
   el código, preguntá al humano ANTES de lanzar nada: un coder que adivina multiplica el retrabajo
   por cada rama.
2. **El registro.** Preguntá si el trabajo lleva ítem del gestor o `no-issue: <motivo>` (lo exige
   `commit-msg`); el coder lo necesita para `task.mjs start`.
3. **Partir en unidades independientes.** Una unidad = un conjunto de criterios de aceptación que se
   implementa sin tocar los **archivos** de otra. Medí el radio de impacto con el `explorer` (y el
   `librarian` si la spec cita decisiones) para saber qué toca cada una. Dos unidades que comparten
   archivo **no** van en paralelo: van en secuencia o en la misma unidad — dos ramas sobre el mismo
   archivo son un conflicto programado. Si sale una sola unidad, se lanza un solo coder.
4. **Mostrar el plan y esperar el «sí».** Tabla: unidad · criterios · alcance (rutas) · rama
   propuesta (patrón de `workflow.branchPattern`) · dependencias. Lanzar N agentes cuesta N veces.
5. **Preparar el contexto de cada unidad.** Un coder lanzado como subagente **no puede** lanzar al
   `librarian` ni al `explorer`, así que se los lanzás vos antes, en paralelo y en el mismo mensaje,
   y lo que devuelven va **en el brief**: los símbolos y el radio de impacto de su alcance
   (`explorer`), y las decisiones y guías que la spec toca, con `ruta:línea` (`librarian`).
6. **Lanzar.** El brief de cada uno lleva: la spec (o la parte que le toca), sus criterios, su
   alcance, la rama, el ítem o el `no-issue`, el contexto del paso 5, y **los archivos que son de
   otro coder** y no tiene que tocar. Dos vías:
   - **En esta sesión** (rápido, una o pocas unidades): una llamada al subagente `coder` por unidad
     con `isolation: "worktree"`, todas en un solo mensaje. El worktree queda dentro de `.claude/`
     (ignorado; la señal «worktrees out of sight» lo vigila).
   - **Como sesión propia** (el coder puede delegar, su worktree queda fuera de la raíz): escribí
     cada brief en un archivo del scratchpad y corré `node scripts/coder-spawn.mjs --unit <slug>
     --branch <rama> --brief <archivo>` — primero en dry-run, mostralo, y con el «sí» `--apply`, un
     proceso en segundo plano por unidad. Necesita `coder` en el config.
   Las unidades dependientes se lanzan cuando su dependencia devolvió `ENTREGA: LISTA`.
7. **Juntar.** Por cada coder: `ENTREGA`, rama, gate, supuestos, desbloqueos y preguntas.
   - `CON PREGUNTAS` → llevá las preguntas al humano tal cual (con la recomendación del coder) y,
     con la respuesta, retomá ESE coder; no contestes por el humano.
   - `BLOQUEADA` → no reintentes con el mismo brief: escalá con el diagnóstico (P12).
   - `LISTA` → lanzá el `reviewer` sobre esa rama (independiente de quien escribió). Un desbloqueo
     de prueba es lo primero que tiene que mirar.
8. **Reportar.** Una línea por rama: estado, gate, review, y qué falta para el PR. No mergees ni
   empujes sin que el humano lo pida.

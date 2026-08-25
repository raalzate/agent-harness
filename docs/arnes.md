# El arnés de este repo — cómo está montado

Este repo se audita a sí mismo: es el ejemplo trabajando. La regla que manda es la misma que
propone a los demás: **una regla sin un comando que la haga fallar es una sugerencia.** Cada fila
de este documento nombra el comando que falla si alguien la viola.

Lo particular acá: el "producto" es el arnés, así que las señales del gate son las del propio
arnés. En tu repo serían tipos, tests y build; el mecanismo es idéntico.

## El gate

```bash
npm run gate        # self-test · link-check de docs · lint de convenciones
npm run gate:fast   # igual (este repo no tiene señales lentas todavía)
```

`scripts/gate.sh` es la única definición del gate, y **no sabe de stacks**: ejecuta la lista de
`.claude/harness.config.json` → `gate.signals`. Lo corren tres actores con el mismo comando: el
humano, el agente (subagente `gate-runner`) y CI (`.github/workflows/ci.yml`). Al terminar en verde
borra `.git/gate-dirty`, que es lo que mira el hook `Stop`.

| Señal (nombre en `gate.signals` · comando) | Qué prueba | Por qué no la cubre otra |
|---|---|---|
| **self-test del arnés**<br>`node scripts/harness-selftest.mjs` | que los frenos bloquean lo que dicen bloquear y que ninguna ruta ni regex del config apunta a la nada | un hook roto o un config inválido fallan en silencio: ninguna otra señal los ve |
| **link-check de docs**<br>`node scripts/docs-linkcheck.mjs` | que ninguna referencia a un doc o a una ruta del repo apunte a la nada | mover un archivo rompe punteros que ninguna otra señal mira |
| **artefactos en su lugar**<br>`node scripts/artifacts-check.mjs` | que los artefactos de trabajo estén donde el equipo declaró (`tracker.artifactsIn`), sin tocar la red | tener spec y plan a medias en dos lugares no lo mira ninguna otra señal, y se descubre cuando alguien busca el plan |
| **lint de convenciones**<br>`node scripts/repo-lint.mjs` | las convenciones del repo: pureza de los hooks, contrato de exit codes, literales de evento, TODOs sin issue, y que todo gotcha declare su `Mecanismo:` | son reglas de dominio: ninguna config estándar las conoce |

**Test verde ≠ compila ≠ entregable.** Reportar "listo" sin gate verde es una violación, no un
descuido. Y una señal **omitida no es verde**: el gate imprime las omisiones aparte, siempre.

## Hooks del ciclo del agente (`.claude/settings.json`)

Los hooks son **genéricos**: toda la especificidad del repo vive en
`.claude/harness.config.json`, y `.claude/hooks/harness.mjs` es la plomería compartida
(stdin → config → decisión). Cambiar una regla es editar JSON, no código.

| Momento | Hook | Qué hace |
|---|---|---|
| `SessionStart` | `session-start.mjs` | imprime rama, HEAD, cambios sin commitear y `STATUS.md`; avisa si el pre-commit no está instalado o si hay gate pendiente |
| `UserPromptSubmit` | `ask-first.mjs` | si el pedido es informativo (pregunta, reporte sin imperativo), marca el turno: **no se actúa sobre una pregunta** |
| `UserPromptSubmit` | `sdd-router.mjs` | clasifica el pedido (feature → ruta SDD, falla → test rojo primero, ambiguo → preguntar una cosa); se calla en lo trivial |
| `UserPromptSubmit` | `graph-first.mjs` | si hay índice del repo construido, empuja a consultarlo antes de abrir archivos; callado si no existe |
| `PreToolUse` Write\|Edit | `action-guard.mjs` | deniega editar dentro del repo mientras el turno esté marcado como informativo; lo limpia el próximo pedido del humano |
| `PreToolUse` Write\|Edit | `protected-paths.mjs` | deniega editar lo que declara `protectedPaths` |
| `PreToolUse` Write\|Edit | `reuse-guard.mjs` | bloquea boilerplate que ya tiene abstracción (`reuse`) |
| `PreToolUse` Bash | `bash-guard.mjs` | deniega los comandos de `bash.deny` |
| `PostToolUse` Write\|Edit | `post-edit-check.mjs` | corre el lint **sobre el archivo tocado** y devuelve el error real; marca `.git/gate-dirty` |
| `Stop` | `gate-stop.mjs` | impide cerrar la tarea si se editó código y el gate no quedó verde |

El contrato con Claude Code, que es lo que hace que todo esto funcione: la entrada llega como JSON
por stdin; **exit 0** = seguir (y el stdout de `UserPromptSubmit`/`SessionStart` entra al contexto);
**exit 2** = bloquear, y stderr es lo único que el agente lee. Un `exit 1` es un error del hook, no
una decisión — por eso hay un `invariants` que lo prohíbe en `harness.mjs`.

En git, además:

| Hook | Qué hace |
|---|---|
| `.githooks/pre-commit` | rutas protegidas + lint de los archivos staged |
| `.githooks/commit-msg` | **el trabajo no entra al historial sin quedar registrado**: si el commit toca código, el mensaje referencia el ítem de trabajo (`tracker.issuePattern`) o declara `sin-issue: <motivo>`. Agnóstico de forja — ver `docs/trazabilidad.md` |
| `.githooks/post-commit` | opcional: refresca lo derivado (un índice, un grafo) |

Se instalan con `npm run hooks:install` — `core.hooksPath` debe valer `.githooks`; `.git/hooks/`
sólo tiene `.sample` a propósito.

## El self-test: qué prueba exactamente

Es la pieza que distingue un arnés vivo de un arnés decorativo. Genera los casos **desde el
config**, así que una regla nueva queda cubierta sin escribir un caso a mano:

1. cada hook declarado en `settings.json` existe y `node --check` lo parsea;
2. cada ruta del config resuelve y cada regex compila;
3. **los frenos muerden**: por cada regla de `protectedPaths`, `bash.deny` y `reuse` reduce el
   patrón a una muestra concreta y verifica que el hook devuelva exit 2;
4. **los frenos no muerden de más**: un archivo normal y un `git status` tienen que pasar;
5. **las reglas del lint muerden**: le pasa el contenido por stdin (`--file <ruta> --stdin`), así
   nunca escribe archivos temporales dentro del árbol de fuentes;
6. el clasificador de pedidos no se degrada, y se calla en lo trivial;
7. las señales del gate existen, son ejecutables y **declaran su `why`**;
8. **el registro no es opcional**: seis casos de `commit-msg` en un repo git temporal —código sin
   referencia, con referencia, con la fuga y su motivo, la fuga pelada, extensión ignorada, un
   merge— todos derivados del config, más un cebo para `artifacts-check`;
9. los subagentes y comandos tienen frontmatter válido (sin él, Claude Code no los ofrece).

Lo que no puede reducir a un ejemplo lo reporta como **omitido**, nunca como pasado.

## Subagentes (`.claude/agents/`)

| Subagente | Para qué | Por qué aislado |
|---|---|---|
| `explorer` | búsqueda amplia; índice antes que lectura de archivos | la exploración contamina el contexto principal |
| `reviewer` | revisa el diff contra los principios BLOCKING de `CONSTITUTION.md` | el review no lo hace quien escribió el código |
| `gate-runner` | corre el gate y reporta veredicto + error real | miles de líneas de log no entran al contexto principal |

## Comandos (`.claude/commands/`)

| Comando | Flujo que evita re-tipear |
|---|---|
| `/gate [fast]` | correr el gate aislado e interpretar el resultado sin reintento ciego |
| `/lesson <incidente>` | ciclo RHO: minar la causa → codificar en el mecanismo más fuerte → validar con el gate |
| `/harness-audit` | prueba de vida: ¿qué comando falla si se viola cada regla? |
| `/harness-port <repo>` | instalar el arnés en otro repo y dejarlo verde allá |

## Skills (`.claude/skills/`)

| Skill | Para qué |
|---|---|
| `nuevo-freno` | convierte una regla escrita en prosa en un freno ejecutable, con su prueba de vida |

## Memoria

| Archivo | Contenido | Carga |
|---|---|---|
| `CLAUDE.md` | reglas operativas del repo | siempre |
| `CONSTITUTION.md` | principios versionados con su fuerza y su mecanismo | siempre |
| `STATUS.md` | estado verificado + deuda conocida | `SessionStart` |
| `docs/gotchas.md` | síntoma → causa → regla → mecanismo | bajo demanda / `/lesson` |
| `docs/decisions/` | ADRs: por qué, no qué | bajo demanda |
| `docs/trazabilidad.md` | cómo queda registrado el trabajo, en cualquier forja | bajo demanda |
| `docs/buenas-practicas.md` | la guía de fondo, agnóstica de stack | bajo demanda / `/harness-audit` |

## Conducta ante el error

- **Integridad de aserciones:** jamás se ajusta una aserción para que pase el test. Si el test es
  correcto, se arregla producción; si el test es incorrecto, se corrige en un commit aparte con
  justificación.
- Saltarse la verificación está prohibido (lo bloquea `bash-guard.mjs`). Si el gate estorba, se
  arregla el gate.
- Leer la salida real (archivo, línea, mensaje) antes de reintentar. Reintento sólo con hipótesis
  nueva.
- Presupuesto: **2 intentos** sobre el mismo error; al tercero se para y se escala con el
  diagnóstico.

## Deuda conocida del arnés

- **El ruteo informa, no bloquea.** Nada impide entregar una feature grande sin declarar la ruta
  salvo el criterio del agente y el review: la intención no es verificable por máquina. Lo que sí
  bloquea es `commit-msg`: el trabajo no llega al historial sin registro. Pero pide *un* registro,
  no el *correcto* — que una feature vaya con ítem madre y tareas en vez de un bug suelto sigue
  siendo criterio.
- **`bash.deny` es un guardarraíl, no un sandbox.** Sube el costo del error accidental; un agente
  puede reformular el comando. Para aislamiento real hace falta contenedor o permisos del sistema.
- **`sampleFromPattern` no reduce todos los regex.** Los patrones con lookbehind, backreferences o
  clases anidadas se reportan **omitidos** y hay que probarlos a mano. Preferido a un falso verde.
- **`post-edit-check` corre lint, no el type-check completo** (demasiado lento por edición): el
  typecheck, en los repos que lo tengan, vive en el gate.
- **El lint no usa AST.** Son regex sobre texto: alcanza para las reglas que cubre y no tiene
  dependencias, pero un patrón dentro de un comentario o de un string cuenta igual. Cuando eso
  moleste de verdad, la señal correcta es un linter del stack, no complicar este script.

# El arnés de <PROYECTO>

Este documento describe **el arnés de este repo**: qué se verifica, con qué comando, y qué error
atrapa cada freno. Lo citan `CONSTITUTION.md`, los subagentes y el comando `/harness-audit`.

Se llena al portar el arnés —la receta vive en el repo del arnés— y se actualiza cuando cambia una señal. Si acá dice
algo que ningún comando hace cumplir, eso es el bug.

## El gate

El entregable es **una** línea: `<comando del gate>`. Lo corren los tres actores con el mismo
comando: el humano, el agente (subagente `gate-runner`) y CI.

| Señal | Comando | Qué error atrapa que ninguna otra ve |
|---|---|---|
| self-test del arnés | `node scripts/harness-selftest.mjs` | un hook roto o un config que apunta a la nada: fallan en silencio |
| link-check de docs | `node scripts/docs-linkcheck.mjs` | un puntero roto manda al agente a leer un archivo que no existe |
| lint de convenciones | `node scripts/repo-lint.mjs` | las reglas de este repo que ningún compilador ve |
| artefactos en su lugar | `node scripts/artifacts-check.mjs` | un plan suelto en el repo cuando el trabajo vive en el gestor |
| `<señal del stack>` | `<comando>` | `<qué atrapa>` |

Una señal **omitida** no es verde, y el modo `fast` tampoco es entregable: omite las señales lentas.

## Los hooks

| Evento | Hook | Qué hace |
|---|---|---|
| SessionStart | `session-start.mjs` | imprime rama, HEAD, cambios sin commitear y `STATUS.md` |
| UserPromptSubmit | `ask-first.mjs` | una pregunta se contesta; sobre una pregunta no se actúa |
| UserPromptSubmit | `sdd-router.mjs` | pone el criterio delante del agente según el tamaño del pedido |
| PreToolUse | `protected-paths.mjs` | secretos, lockfiles y derivados no los edita el agente |
| PreToolUse | `bash-guard.mjs` | comandos irreversibles o que saltan la verificación |
| PreToolUse | `reuse-guard.mjs` | boilerplate que este repo ya resolvió |
| PostToolUse | `post-edit-check.mjs` | corre el lint del archivo tocado y marca el gate pendiente |
| Stop | `gate-stop.mjs` | no se cierra con código editado y gate sin correr |

Contrato: exit 0 = seguir, exit 2 = bloquear (stderr es lo único que el agente lee). Un config
ausente o inválido **deja pasar**: el arnés no puede bloquear al humano por estar roto.

## Reglas activas

```bash
node scripts/repo-lint.mjs --rules
```

Cada regla vive en `.claude/harness.config.json` y **cada una tiene detrás una cicatriz de este
repo** (`docs/gotchas.md`). Una regla sin incidente detrás se saca: entrena al equipo a ignorar los
frenos.

## Qué NO verifica ninguna máquina

`<lo que queda a criterio del reviewer y del humano: que la regla elegida sea la correcta, que el
registro de trabajo sea el adecuado, que el mecanismo sea el más fuerte disponible>`

Escribirlo acá es la diferencia entre una deuda declarada y un agujero tácito.

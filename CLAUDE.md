# Claude Code Instructions — Agent Harness

@CONSTITUTION.md

---

## Qué es este repo

El producto **es el arnés**: hooks, gate, self-test, subagentes, comandos y docs para que otro repo
—en cualquier lenguaje— tenga reglas que se hacen cumplir solas. No hay aplicación, no hay UI, no
hay dependencias: corre con `node` y `bash`.

Consecuencia práctica: este repo se audita a sí mismo. Su gate son las señales del propio arnés, y
si algo acá no cumple lo que el arnés predica, eso **es** el bug.

## Arquitectura en una frase

`.claude/harness.config.json` declara las reglas; los hooks y los scripts las ejecutan sin saber
nada del repo.

```
.claude/harness.config.json   la única fuente de especificidad
.claude/hooks/                8 hooks genéricos; harness.mjs es la plomería compartida
.claude/agents/               explorer · reviewer · gate-runner
.claude/commands/             /gate · /lesson · /harness-audit · /harness-port
scripts/gate.sh               ejecuta gate.signals; no sabe de stacks
scripts/repo-lint.mjs         8 clases de regla, todas configurables
scripts/harness-selftest.mjs  prueba de vida: genera los casos DESDE el config
scripts/harness-bench.mjs     el arnés instalado en un repo real de cada stack (el encaje)
scripts/harness-init.mjs      instalador en otro repo (dry-run por defecto, con perfil de stack)
plantillas/perfiles/          8 perfiles de stack: hechos del lenguaje, nunca reglas
plantillas/ examples/ docs/   lo que se copia y lo que se lee
```

## Reglas de desarrollo

- **Nada específico de un repo entra al código.** Si hace falta un literal de dominio en un hook o
  en un script, la respuesta correcta es una clave nueva del config (P4).
- **Nada específico de un LENGUAJE tampoco.** Una lista de extensiones, una sintaxis de import o la
  forma de un manifiesto van al config con default agnóstico, y su caso del self-test se deriva de
  esa clave. Un freno cuya prueba de vida usa el único stack donde funciona no prueba nada.
- **Un freno nuevo llega con su prueba de vida.** Si es una regla del config, el self-test lo cubre
  solo. Si es una clase de regla nueva o un hook nuevo, el caso se escribe a mano (P2).
- **Validación doble, siempre:** `npm run selftest` (¿muerde?) y `npm run lint` (¿no muerde de más?).
  La segunda es la que se olvida y la que importa (P3).
- **Los hooks no lanzan procesos** salvo las dos excepciones declaradas en `purity.except`
  (`post-edit-check` corre el lint del archivo tocado; `session-start` lee git una vez por sesión).
  Un hook que lanza procesos cuesta latencia en cada edición o en cada prompt.
- **Contrato de exit codes:** 0 = seguir, 2 = bloquear (stderr es lo que el agente lee). Nunca 1.
  Un config ausente o inválido **deja pasar**: el arnés no puede bloquear al humano por estar roto.
- **Escribir la config con el editor, no con heredoc del shell.** El archivo contiene los patrones
  que él mismo prohíbe, así que `bash-guard` lo bloquea. Está en `docs/gotchas.md`.
- **Los mensajes de bloqueo explican el porqué.** El texto de `reason`/`message` es la única cosa
  que el agente lee cuando lo frenás: es la diferencia entre que entienda y que reintente.

## Antes de dar algo por terminado

```bash
npm run gate           # EL entregable: self-test · link-check · lint · artefactos · banco
npm run selftest       # ¿los frenos muerden?
npm run lint           # ¿el repo pasa con las reglas activas?
npm run lint:rules     # ¿qué reglas están activas y de dónde salen?
```

- CI (`.github/workflows/ci.yml`) corre **el mismo** `npm run gate`. No mergear en rojo.
- Pre-commit real: `npm run hooks:install` (`core.hooksPath=.githooks`). Saltarse la verificación
  está prohibido: si el gate estorba, se arregla el gate.
- Al cambiar el arnés, probá también el portado: `node scripts/harness-init.mjs <repo> ` en dry-run
  sigue siendo la mitad del producto. Si tocás un perfil de stack, la sección 8 del self-test lo
  instala en un repo temporal y el **banco** (`node scripts/harness-bench.mjs`) lo instala en un
  repo de juguete de ese stack con archivos reales: no hace falta un repo de .NET a mano. Perfil
  nuevo = *fixture* nuevo en el banco, o del perfil sólo se verifica la forma.

## Documentación: qué va dónde

| Contenido | Archivo |
|---|---|
| la teoría, agnóstica de stack | `docs/buenas-practicas.md` (**ruta protegida**: se enmienda en su propio commit) |
| cómo se instala en otro repo | `docs/portar.md` |
| portarlo a .NET, JVM, Python, Go, Rust, front | `docs/perfiles.md` |
| qué hace cada clave del config | `docs/config-reference.md` |
| el arnés de ESTE repo | `docs/arnes.md` |
| recetas concretas | `docs/recetas.md` |
| incidentes | `docs/gotchas.md` (formato fijo, lo exige el lint) |
| por qué está hecho así | `docs/decisions/` |

Cuando agregues una clave al config, actualizá `docs/config-reference.md` **y** la tabla de "quién
lee cada clave": esa tabla es lo que evita romper algo al tocar una clave.

## Estilo

- Español, comentarios que explican el **porqué** y no el qué, siguiendo el archivo vecino.
- Sin dependencias. Nunca. Es lo que hace al arnés copiable en cualquier repo.
- Los mensajes al agente (bloqueos, salidas del gate) son cortos y accionables: qué pasó, por qué
  importa, qué hacer.

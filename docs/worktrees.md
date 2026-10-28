# Worktrees: un agente, una carpeta, una rama

Cuando dos agentes (o un agente y vos) trabajan a la vez en el mismo repo, el choque no es de ideas:
es de **archivos**. Los dos editan el mismo árbol de trabajo, uno cambia de rama bajo los pies del
otro, y el gate de uno mide el código a medio escribir del otro. Un **worktree** lo evita sin
clonar el repo otra vez.

## Qué es

Un worktree es **otra carpeta del mismo repo, con su propia rama**. Comparte con las demás el
historial y los objetos (un solo `.git` real), pero cada carpeta tiene su propio índice, su propio
`HEAD` y sus propios archivos. Git además impide tener la misma rama en dos worktrees a la vez, así
que dos agentes no pueden pisarse la rama por accidente.

```
repo/                      ← checkout principal, rama main
  .git/                    ← el único historial, compartido
../wt-tarea-a/             ← worktree, rama feat/tarea-a, un agente
../wt-tarea-b/             ← worktree, rama feat/tarea-b, otro agente
```

En un worktree `.git` no es una carpeta sino un archivo (`gitdir: <ruta>`). El arnés ya lo resuelve
(`rutaDeEstado` en `.claude/hooks/harness.mjs`), y el self-test lo prueba en un repo temporal.

## El ciclo

```bash
# 1. Crear: carpeta FUERA del repo, rama nueva con el patrón del workflow
git worktree add ../wt-tarea -b feat/tarea

# 2. Abrir la sesión del agente DENTRO de ../wt-tarea (no entrar con cd desde otra sesión)
#    Preparar lo que git no trae: dependencias, .env local, índice del código
npm ci

# 3. Declarar la tarea (alcance + criterios) y trabajar
node scripts/task.mjs …

# 4. Antes de dar por terminado: el mismo gate de siempre
node scripts/gate.mjs

# 5. Registrar y entrar por PR (`#N` o `no-issue:` en el commit, main solo por PR)
git push -u origin feat/tarea

# 6. Cuando el PR se integró: borrar el worktree, sin --force
git worktree remove ../wt-tarea
git worktree prune
```

## Qué ya garantiza el arnés

| Garantía | Cómo |
|---|---|
| La tarea declarada es **por worktree**: cada agente tiene su propio `alcance` y sus propios criterios | `task.file` vive en `.git/…`, que en un worktree se resuelve a **su** gitdir (`rutaDeEstado`); self-test 3e |
| Los hooks de Claude Code corren desde el worktree | cada comando está anclado a `$CLAUDE_PROJECT_DIR` (ver el gotcha del `cd`) |
| Los hooks de git corren en cada worktree | `core.hooksPath=.githooks` es relativo y `.githooks/` está versionado: `hooks-install` una vez por clone |
| El panel, `hooks-timing` y `skipIfMissing` resuelven sus rutas `.git/…` al gitdir real, no al árbol | `panel/generar.mjs`, `hooks-timing.mjs`, `gate.mjs` (ver el hueco del registro más abajo) |
| La misma rama no se abre dos veces | lo impone git |
| La medición `--verify-red` usa su propio worktree temporal, fuera del repo, y no deja ninguno registrado | `cycle-check.mjs`, self-test «ciclo (rojo sin el cambio)» |

## Reglas

1. **El worktree vive fuera de la raíz del repo.** Adentro, cada escaneo del repo (link-check, lint,
   búsquedas) lee la copia como si fueran documentos propios, y el gate se pone rojo lejos de la
   causa. Ver el gotcha de abajo.
2. **La sesión se abre dentro del worktree.** Un `cd` del agente desde otra sesión es la forma de
   desactivar los hooks sin que nada avise ([gotcha](gotchas.md)).
3. **Un worktree, una tarea, un `alcance`.** Partí el trabajo con alcances que no se solapen: es la
   manera de que la integración no sea un choque de merge. Si dos tareas tocan el mismo archivo,
   no van en paralelo.
4. **Preparalo antes de medir.** Un worktree nuevo no trae nada ignorado (`node_modules/`, `.venv`,
   `.env`, índice del código). Sin dependencias el gate falla por falta de ellas, no por el código;
   sin índice, la señal del índice se omite (y una señal omitida no es verde).
5. **El gate del worktree es el gate.** Verde ahí, no verde en el principal: es lo que entra por PR.
6. **Se borra al integrar, sin `--force`.** `git worktree remove --force` descarta cambios sin
   commitear. Sin `--force`, git se niega si hay algo sin guardar: dejá que se niegue.
7. **Nombres.** La rama sigue `workflow.branchPattern`; la carpeta, un prefijo que se reconozca
   (`wt-<tarea>`). La carpeta no está validada: es convención.

## Lo que no verifica ninguna máquina (todavía)

Declarado, no escondido. Cada fila es un hueco que se puede cerrar con un freno y su caso de
self-test:

| Hueco | Qué haría falta |
|---|---|
| Un `git worktree remove --force` pasa `bash-guard` | una regla en `bash.rules`, con su caso inocente (sin `--force`) |
| Un worktree dentro de la raíz no lo detecta el genérico | una señal del gate que liste `git worktree list` y falle por los que estén bajo el repo |
| Worktrees huérfanos (rama ya integrada, carpeta viva) | la misma señal, en modo aviso |
| El nombre de la carpeta | nada: convención |
| El registro de la corrida (`gate.registry`, `.git/harness-gate.json`) no se escribe desde un worktree: el gate avisa `no pude escribir el registro … EEXIST` y sigue. Lo que lo lee (`deploy.mjs`, `ci-investigate.mjs`) no ve esa corrida | resolver esa ruta con `rutaDeEstado`, como ya hacen `task.mjs` y el panel (`gate.mjs:238`, `deploy.mjs:117`, `ci-investigate.mjs:198`), con su caso de self-test |

## Prueba de vida

```bash
git worktree list                         # los worktrees registrados; ninguno bajo la raíz
node scripts/harness-selftest.mjs         # 3e: «en un worktree la tarea se abre y el alcance muerde»
```

Ver también: [ciclo-desarrollo.md](ciclo-desarrollo.md) (el modelo de ramas),
[multi-proyecto.md](multi-proyecto.md) (varios repos), [gotchas.md](gotchas.md) (el `cd` y la
ubicación del worktree).

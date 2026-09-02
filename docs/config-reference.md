# Referencia de `.claude/harness.config.json`

El único archivo específico del repo. Los hooks y los scripts son genéricos: leen de acá.
**Portar el arnés = reescribir este archivo.**

Convención: cualquier clave que empiece con `$` (`$comment`, `$github`) es documentación para
quien lo lea y ninguna herramienta la interpreta. Usalas: un config sin comentarios se vuelve
folklore en tres meses.

Al final hay una [tabla de qué lee qué](#quién-lee-cada-clave): sirve para saber qué se rompe si
tocás una clave.

---

## `gate` — la definición de entregable

```json
"gate": {
  "command": "npm run gate",
  "fastCommand": "npm run gate:fast",
  "marker": ".git/gate-dirty",
  "codeGlobs": ["src/", "scripts/"],
  "signals": [
    { "name": "typecheck", "command": ["npx", "tsc", "--noEmit"],
      "why": "el runner de tests no type-checkea: un import inválido pasa la suite" },
    { "name": "build", "command": ["npm", "run", "build"], "fastSkip": true,
      "why": "dev y prod difieren: tree-shaking, resolución de módulos, empaquetado" },
    { "name": "e2e", "command": ["npm", "run", "e2e"], "skipIfMissing": "apps/web",
      "why": "el flujo completo que ningún test unitario cubre" }
  ]
}
```

| Clave | Qué hace |
|---|---|
| `command` / `fastCommand` | lo que el agente y los mensajes de error le dicen al humano que corra. **No** es lo que se ejecuta: eso son las `signals` |
| `marker` | archivo que marca "hay código editado sin gate verde". Lo escribe `post-edit-check`, lo borra `gate.sh` al terminar verde, lo lee el hook `Stop` |
| `codeGlobs` | qué rutas cuentan como **código**. Editar un `.md` no ensucia el gate; editar `src/` sí |
| `codeExtensions` | qué **extensiones** cuentan como código. Vacío = el hook usa un superconjunto agnóstico (JS, .NET, JVM, Python, Go, Rust, C/C++). Estaba cableada en `post-edit-check.mjs`: por eso el freno de mayor retorno estaba muerto en todo repo que no fuera JS/TS |
| `installHooksCommand` | el comando que instala los hooks de git **en este repo**. Lo nombra `session-start` cuando `core.hooksPath` no está puesto: un aviso que cita un comando inexistente se ignora completo |
| `signals[].name` | lo que se imprime |
| `signals[].command` | array argv. Sin shell y sin `eval`: ningún dato del config se interpola en una línea de comandos |
| `signals[].why` | por qué esta señal no la cubre otra. **Obligatorio** (el self-test lo exige): es lo único que va a defender a la señal cuando tarde y alguien la quiera sacar |
| `signals[].fastSkip` | `true` = se omite en modo `fast` |
| `signals[].skipIfMissing` | ruta que, si no existe, hace que la señal se reporte **OMITIDA** en vez de fallar. "Omitida" se imprime siempre: nunca se confunde con "pasó" |

**Orden de las señales:** de la más barata y más informativa a la más lenta. El self-test primero
(un freno roto invalida todas las demás señales), el build último.

---

## `protectedPaths` — lo que el agente no edita

```json
[{ "pattern": "^\\.env", "reason": ".env* es la llave del reino: lo edita el humano." }]
```

`pattern` es un regex contra la ruta **relativa a la raíz del repo, con `/`**. `reason` es lo que
el agente lee cuando lo bloqueás: escribí el porqué, no la prohibición.

Lo leen dos ejecutores distintos con una sola definición: el hook `protected-paths.mjs` (antes de
escribir) y `.githooks/pre-commit` (antes de commitear). Que el humano también quede frenado es
deliberado: si la ruta es sagrada, lo es para todos.

`"agentOnly": true` marca la excepción a eso: el archivo se protege de la **edición por el agente**,
pero commitearlo es normal. Es para documentos de gobernanza que se enmiendan a conciencia — sin la
marca, el pre-commit haría imposible crear el archivo la primera vez.

---

## `bash.deny` — comandos sin ctrl-Z

```json
"bash": { "deny": [{ "pattern": "terraform\\s+(apply|destroy)", "reason": "…" }] }
```

Regex contra la línea de comandos completa. La lista genérica ya viene; lo que hay que agregar es
lo irreversible **de tu stack** (ver [portar.md](portar.md) paso 2).

Ojo con el falso negativo obvio: el agente puede reformular. Esto no es un sandbox, es un
guardarraíl — sube el costo del error accidental, no detiene a un adversario.

---

## `reuse` — boilerplate que ya tiene abstracción

```json
[{ "pattern": "new\\s+PrismaClient\\(", "appliesTo": "^src/(?!lib/db\\.ts)",
   "reason": "el cliente se instancia una vez en src/lib/db.ts: una instancia por módulo agota el pool.",
   "see": "src/lib/db.ts" }]
```

Evita el fallo más caro y más silencioso de un agente: reimplementar algo que el repo ya resuelve.
`appliesTo` acota el ámbito, `see` apunta a la abstracción y **tiene que existir** (el self-test lo
verifica).

Una entrada por abstracción que se reimplementó al menos una vez. No las escribas por adelantado.

---

## `lint` — cómo se invoca el lint del repo

```json
"lint": { "command": ["node", "scripts/repo-lint.mjs"], "fileFlag": "--file" }
```

Lo usa el hook `PostToolUse` para correr el lint **sobre el archivo que se acaba de tocar** y
devolver el error real (archivo, línea, mensaje) en el momento, en vez de que el agente se entere
diez ediciones después. Es el freno de mayor retorno del arnés.

`sourceExtensions` acota qué archivos BARRE el lint completo. Si `gate.codeExtensions` declara algo
que **no** está en el default (un `.csproj`, por ejemplo: es XML, no código), hay que declararlo
también acá — el self-test lo exige, en este repo, en cada perfil y en cada ejemplo publicado. Ausente = el mismo superconjunto
agnóstico que usa `gate.codeExtensions`. Son dos claves porque son dos preguntas —qué ensucia el
gate vs. qué archivos llevan reglas— pero comparten un solo default: cuando eran dos listas
cableadas divergieron, y un `.pyi` ensuciaba el gate mientras el barrido nunca lo leía (PATRON y
PUREZA ciegas ahí). El self-test verifica que todo lo de `gate.codeExtensions` lo barra el lint.

---

## `purity` — la capa que queda limpia

```json
[{ "dir": "src/lib",
   "forbiddenImports": ["react", "electron", "next/"],
   "except": ["src/lib/bootstrap.ts"],
   "reason": "lib es lógica pura y testeable: los componentes orquestan, lib decide." }]
```

Es un array: podés tener varias capas. `except` son rutas exactas y son **deuda declarada**.

**Sintaxis de import.** Cómo se escribe "importar X" depende del lenguaje, así que el default es un
superconjunto: `from "x"`, `require("x")`, `import x`, `from x import`, `using X;` (C#/F#),
`use x;` (Rust/PHP), `#include <x>` (C/C++). Se puede angostar por capa (`purity[].importSyntax`) o
por repo (`purityImportSyntax`), como plantillas con `{mod}`:

```json
{ "purityImportSyntax": ["^\\s*using\\s+(?:static\\s+)?{mod}\\b"] }
```

Ensancharla **no** se hace editando código: el default ya cubre las familias conocidas, y una
familia nueva es una plantilla más en el config (P4). Cada plantilla declarada queda cubierta por el
self-test, que deriva de ella una línea de ejemplo y exige que el lint la muerda.

---

## `forbiddenDeps` — dependencias vetadas

```json
{ "manifest": "package.json", "packages": ["moment", "request"],
  "matcher": "^\\s*[\"']?{pkg}[\"']?\\s*[:=]",
  "reason": "sin mantenimiento: migrar, no agregar." }
```

Con `packages` vacío la regla no corre. `matcher` es una plantilla con `{pkg}`: el default entiende
manifiestos **clave-valor** (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`). Un
manifiesto con otra forma necesita el suyo, o la regla sale **verde con la dependencia prohibida
presente** — la peor variante de señal:

| Manifiesto | `matcher` |
|---|---|
| `.csproj` / `Directory.Packages.props` | `PackageReference\\s+Include\\s*=\\s*["']{pkg}["']` |
| `pom.xml` | `<artifactId>\\s*{pkg}\\s*</artifactId>` |
| `build.gradle(.kts)` | `["']{pkg}[:"']` (el `pkg` es `grupo:artefacto`) |
| `pyproject.toml` | `^\\s*["']?{pkg}["']?\\s*[=<>~]` |

Cada uno viene ya escrito en el perfil de stack correspondiente (`plantillas/perfiles/`).

---

## `singleSource` — un registro, una verdad

```json
[{ "id": "ERRORES",
   "source": "src/errors.ts",
   "literals": ["NOT_FOUND", "FORBIDDEN"],
   "extract": "code:\\s*\"([A-Z_]+)\"",
   "appliesTo": "^src/(?!errors\\.ts)",
   "allow": ["src/legacy/handler.ts"],
   "reason": "los códigos de error salen del registro: duplicarlos hace que cambiar uno rompa la mitad." }]
```

`literals` es la lista explícita; `extract` es la alternativa dinámica — un regex con un grupo que
saca los literales **del propio archivo fuente**, así el registro crece sin tocar la config.

`allow` es deuda declarada. **Sólo puede achicarse**; que crezca es un hallazgo de review y se
justifica en `STATUS.md`.

---

## `invariants` — líneas que no se pierden

```json
[{ "file": "src/main.ts",
   "required": ["signal.NotifyContext", "defer cancel()"],
   "forbidden": ["log.Fatal(http.ListenAndServe"],
   "reason": "el apagado ordenado evita cortar peticiones en vuelo en cada deploy." }]
```

Para lo que se rompe **en silencio** cuando alguien "limpia" un archivo de arranque: flags del
runtime, orden de inicialización, apagado ordenado, backend del estado. `required` que no puede
desaparecer, `forbidden` que no puede aparecer.

---

## `patterns` — texto prohibido en un ámbito

```json
[{ "id": "SECRETO",
   "pattern": "process\\.env\\.[A-Z_]*(KEY|TOKEN|SECRET)",
   "appliesTo": "^src/components/",
   "allow": [],
   "message": "un secreto leído en el cliente termina en el bundle público. Leelo en el servidor." }]
```

La clase de regla más usada al portar. `id` aparece en la salida del lint y en el self-test, así
que ponele un nombre que se pueda buscar. `message` explica **por qué** y **qué hacer en su lugar**:
el agente lo lee cuando lo bloqueás.

---

## `tests` — el `.only(` olvidado

```json
{ "filePattern": "(^|/)__tests__/|\\.(test|spec)\\.[cm]?[jt]sx?$",
  "onlyPattern": "\\b(describe|it|test)\\.only\\(" }
```

El freno clásico: un `.only(` que quedó de una sesión de depuración apaga la suite entera **y el
gate sale verde igual**. Adaptá `onlyPattern` a tu runner (`@pytest.mark.only`, un `// only`).

---

## `incidents` — el formato del registro de gotchas

```json
{ "file": "docs/gotchas.md", "heading": "### GOTCHA",
  "requiredLines": ["Síntoma:", "Causa:", "Regla:", "Mecanismo:"] }
```

Hace verificable la única parte mecanizable de "cada incidente deja infraestructura": que el
registro no se degrade a anécdota. La línea que importa es `Mecanismo:` — el comando que ahora
falla si alguien repite el incidente. Si no hay ninguno, se escribe "ninguno ejecutable" con el
motivo: un hueco declarado se puede cerrar, uno tácito no.

---

## `docs` — alcance del link-check

```json
{ "ignore": ["node_modules", "dist"],
  "proseRoots": ["docs", "src", "scripts"],
  "ignoreFiles": ["docs/buenas-practicas.md"],
  "externalPaths": ["vendor/generado/"] }
```

| Clave | Para qué |
|---|---|
| `ignore` | directorios que el link-check no recorre |
| `mustLinkAll` | `[{ file, from, except }]`: un índice tiene que enlazar **todo** lo que hay bajo `from`. Lo que se deja afuera se escribe en `except`, no se olvida |
| `mentionSignals` | documentos que **enumeran** las señales del gate (la página, el doc del arnés). Si entra una señal y el documento no la nombra, es rojo. Verifica hacia un solo lado: que falte una señal es mentira, que sobre texto no |
| `proseRoots` | raíces del repo que se verifican cuando aparecen citadas en prosa. Una raíz que **no** está acá no se verifica: es lo que permite que una guía cite `src/lib/...` como ejemplo de otro repo sin que el gate mienta |
| `ignoreFiles` | documentos cuyas rutas son **ejemplos**, no punteros (una guía agnóstica, una plantilla) |
| `externalPaths` | rutas que genera una herramienta externa y **ninguna máquina puede verificar en el clon**. Declararlas es la forma honesta de decir "esto no se verifica" |

Las rutas se miden contra `git ls-files`, no contra el disco: medir contra el disco deja pasar
punteros a archivos gitignored — verde local, rojo en CI, la peor variante de señal.

---

## `status` — el archivo de estado verificado

```json
{ "file": "STATUS.md",
  "reminder": "Recordá: nada se entrega sin `npm run gate` verde · lecciones con `/lesson`." }
```

`reminder` es la última línea que el agente lee al abrir la sesión: nombrá el comando de gate **real**
de este repo. Vacío = el hook arma uno con `gate.command`.

Lo imprime el hook `SessionStart` (primeras 40 líneas). Sirve para no releer el repo entero para
contestar "¿esto anda?". Sólo lo verificado con un comando; lo que se supone va en deuda conocida.

---

## `branches` — cómo entra el trabajo

```json
{ "protected": ["main", "master"], "reason": "el trabajo entra por pull request…" }
```

Lo lee `.githooks/pre-push`, que falla antes de la red si empujás directo a una de esas ramas y te
da el comando para mover los commits. Es el **complemento local** de la protección de rama de la
forja, no su reemplazo: el freno fuerte vive en el servidor. Sin esta clave, el hook no hace nada.

---

## `askFirst` — no actuar sobre una pregunta

```json
{ "marker": ".git/agent-answer-first",
  "questionPatterns": ["^\\s*¿", "\\?\\s*$"],
  "strongQuestionPatterns": ["^\\s*(qu[eé]|c[oó]mo|cu[aá]l(es)?)(?=\\s|$|[,:])"],
  "actionPatterns": ["\\b(arregl|aplic|agreg|cambi|implement)"],
  "pastPatterns": ["\\b\\w+(aste|iste)(?=\\s|$|[,.?!])"],
  "directRequestPatterns": ["\\b(pod[eé]s|por favor)\\b"],
  "message": "…" }
```

Lo leen `ask-first.mjs` (marca el turno cuando el pedido es informativo) y `action-guard.mjs`
(deniega toda edición dentro del repo mientras el marcador esté). El marcador lo limpia el
siguiente pedido del humano.

Los cuatro conjuntos de patrones son un **desempate**, y el orden importa:

| Clave | Para qué |
|---|---|
| `questionPatterns` | ¿tiene forma de pregunta o de reporte? |
| `actionPatterns` | ¿nombra un verbo de cambio? |
| `pastPatterns` | …¿pero **en pasado**? Entonces pregunta por lo hecho: sigue siendo consulta |
| `strongQuestionPatterns` | ¿**arranca** con interrogativo? Entonces el verbo es el tema, no la orden |
| `directRequestPatterns` | ¿hay pedido directo («¿podés…?», «por favor»)? Entonces sí es orden |

Escribir **fuera** del repo nunca se bloquea: un borrador en el scratchpad es parte de contestar.

---

## `tracker` — el gestor de trabajo, sea cual sea

```json
{ "kind": "github",
  "issuePattern": "(^|[^A-Za-z0-9_])#[0-9]+",
  "issueExample": "#123 · Refs #123 · Closes #123",
  "newIssueHint": ["Bug o mejora acotada:  gh issue create --title \"…\""],
  "artifactsIn": "tracker", "specsDir": "specs", "allowedInRepo": ["specs/README.md"] }
```

| Clave | Qué hace |
|---|---|
| `kind` | informativo, para quien lee el config. Ninguna máquina lo interpreta |
| `issuePattern` | qué cuenta como referencia a un ítem de trabajo en un mensaje de commit. GitHub y GitLab usan `#123`; Azure Boards, `AB#123`; Jira, `PROJ-123` |
| `issueExample` | lo que se le muestra a quien quedó frenado |
| `newIssueHint` | los comandos concretos para abrir el ítem, en el CLI de **tu** forja |
| `artifactsIn` | `"tracker"` o `"repo"`: dónde viven spec, plan y tareas |
| `specsDir`, `allowedInRepo` | qué directorio mira `artifacts-check` y qué se le permite tener |

Ningún script de este arnés conoce una forja: aplican el regex. Detalle por gestor, y la trampa de
los patrones tipo Jira que cazan `UTF-8`, en [trazabilidad.md](trazabilidad.md).

---

## `commitMsg` — qué commits piden registro

```json
{ "codePattern": "^(src/|scripts/)", "ignoreExtensions": [".md", ".png"],
  "skipSubjects": ["Merge ", "Revert ", "fixup! ", "squash! "], "escapeLine": "sin-issue:" }
```

Lo lee `.githooks/commit-msg`. `codePattern` decide qué es **código**; la documentación no pide
registro porque *es* el registro. `escapeLine` es la fuga declarada y exige motivo: un
`sin-issue:` pelado sería la misma omisión con otro nombre. Sin `tracker.issuePattern`, el freno
no corre — se configuran juntos.

---

## `sdd` — ruteo del trabajo

```json
{ "kit": "ninguno", "skillRoots": ["~/.claude/skills"], "phases": [],
  "specsDir": "specs", "activeFeaturePointer": "",
  "routes": [{ "route": "bugfix", "patterns": ["\\bbug\\b"], "message": "test rojo primero." }] }
```

`routes` es lo que vale incluso sin kit SDD: pone el criterio delante del agente **antes** de que
edite. Un `message` vacío significa "esta clase de pedido es trivial, callate" — un router que
habla siempre deja de leerse.

`phases` son skills que tienen que estar instaladas en `skillRoots`; el self-test lo verifica en la
máquina del desarrollador y en CI lo reporta como **omitido**, nunca como pasado.

---

## `postCommit` — refrescar lo derivado (opcional)

```json
{ "name": "índice del repo", "command": ["mi-indexador", "update"], "watch": [".ts", ".md"] }
```

Lo lee `.githooks/post-commit`. Sin esta clave, ese hook no hace nada. Si falla, el commit ya
ocurrió y no se toca: lo derivado es una ayuda de lectura, no parte del entregable.

---

## `graph` — índice consultable (opcional)

Si tu repo tiene un índice de conocimiento (un grafo, un índice de símbolos), esta clave hace que
el hook `graph-first` empuje a **consultar antes de leer** cuando el pedido es "¿dónde está X?".
Claves: `graphFile`, `reportFile`, `queryCommand`, `questionPatterns`. Sin la clave, el hook se
calla — que es lo correcto: un hook que habla sin tener nada que ofrecer sólo gasta contexto.

---

## `examples` — las configs de ejemplo que se publican

```json
{ "dir": "examples",
  "keyValueManifests": ["package.json", "requirements*.txt", "go.mod", "*.toml", "*.cfg", "*.ini"] }
```

`keyValueManifests` son los manifiestos que el `matcher` por default ya entiende. Cualquier otro
formato (XML de `.csproj` o `pom.xml`, notación corta de Gradle) tiene que declarar el suyo.

Sólo aplica al repo que **publica** ejemplos (este). El self-test los parsea, compila sus regex,
exige `why` en cada señal y exige `forbiddenDeps.matcher` cuando el manifiesto no es clave-valor.
Un ejemplo roto viaja igual que un script roto: alguien lo copia.

---

## `profiles` — perfiles de stack del instalador

```json
{ "dir": "plantillas/perfiles",
  "requiredKeys": ["$stack", "$detect", "gate.codeExtensions"],
  "forbiddenKeys": ["patterns", "reuse", "singleSource", "invariants", "gate.signals", "bash.deny", "forbiddenDeps.packages"],
  "reason": "un perfil lleva hechos del lenguaje, no reglas de un equipo." }
```

Sólo aplica al repo que **publica** los perfiles (este). Un perfil describe la **forma** de un stack;
`forbiddenKeys` es el freno que impide que se le metan reglas, y la regla `PERFIL` del lint lo hace
cumplir. El detalle de qué viaja y qué no está en [perfiles.md](perfiles.md).

---

## Quién lee cada clave

| Clave | Lo leen |
|---|---|
| `gate` (`command`, `marker`, `signals`) | `scripts/gate.sh`, `gate-stop.mjs`, `session-start.mjs`, self-test |
| `gate.codeGlobs`, `gate.codeExtensions` | `post-edit-check.mjs` (¿ensucia el gate y se lintea?), self-test |
| `gate.installHooksCommand` | `session-start.mjs` (el aviso de pre-commit sin instalar), self-test |
| `protectedPaths` | `protected-paths.mjs`, `.githooks/pre-commit`, self-test |
| `bash.deny` | `bash-guard.mjs`, self-test |
| `reuse` | `reuse-guard.mjs`, self-test |
| `lint` (incluye `sourceExtensions`) | `post-edit-check.mjs`, `scripts/repo-lint.mjs`, `.githooks/pre-commit`, self-test |
| `purity`, `purityImportSyntax`, `forbiddenDeps`, `singleSource`, `invariants`, `patterns`, `tests`, `incidents` | `scripts/repo-lint.mjs`, self-test |
| `profiles` | `scripts/repo-lint.mjs` (regla `PERFIL`), self-test |
| `examples` | self-test (sección 8) |
| `docs` | `scripts/docs-linkcheck.mjs`, `scripts/repo-lint.mjs` (directorios a saltear) |
| `status` (incluye `reminder`) | `session-start.mjs`, self-test |
| `tracker` | `.githooks/commit-msg`, `scripts/artifacts-check.mjs`, self-test |
| `commitMsg` | `.githooks/commit-msg`, self-test |
| `sdd` | `sdd-router.mjs`, self-test |
| `askFirst` | `ask-first.mjs`, `action-guard.mjs`, self-test |
| `branches` | `.githooks/pre-push`, self-test |
| `postCommit` | `.githooks/post-commit` |
| `graph` | `graph-first.mjs` |

Todo lo que aparece en esta tabla lo verifica `node scripts/harness-selftest.mjs`: una ruta que no
existe o un regex que no compila es **gate rojo**, no un misterio de la semana que viene.

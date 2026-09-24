# Guías y sensores — el marco de *harness engineering*, aplicado a este arnés

Fuente: Birgitta Böckeler, [*Harness engineering for coding agent users*](https://martinfowler.com/articles/harness-engineering.html)
(martinfowler.com, abril de 2026). Este documento **no** lo resume: toma su vocabulario y lo usa
para contestar una pregunta concreta — **de cada idea del artículo, qué mecanismo de este repo la
hace cumplir, y cuál queda como hueco declarado**.

La tesis de fondo coincide con la nuestra: *agente = modelo + arnés*, y el arnés es todo lo que no
es el modelo. Quien construye el agente pone el arnés interno (prompt de sistema, herramientas);
quien lo usa en su repo pone el **externo**. Este repo es un arnés externo portable.

---

## 1. Guías y sensores: dos direcciones de control

El artículo parte el control en dos:

- **Guía** (*feedforward*): anticipa y orienta **antes** de que el agente actúe. Sube la
  probabilidad de acertar al primer intento.
- **Sensor** (*feedback*): observa **después** y le da al agente con qué corregirse.

Con una sola dirección se falla de forma predecible: sólo sensores, y el agente repite el mismo
error cada vez; sólo guías, y el agente codifica reglas sin enterarse nunca de si sirvieron.

Claude Code agrega un momento que el artículo no separa: **entre la decisión y el acto**. Un hook
`PreToolUse` ve la edición o el comando ya decididos y todavía no ejecutados. Acá lo tratamos como
tercera columna, porque es donde vive la mayoría de nuestros frenos:

| Momento | Mecanismo en este repo | Qué hace |
|---|---|---|
| **Guía** — antes de decidir | `CLAUDE.md`, `CONSTITUTION.md`, skills y comandos | convenciones y el porqué, en prosa |
| | hook `session-start` | inyecta rama, working tree y el encabezado de `STATUS.md`: el agente arranca sabiendo qué está verde |
| | hooks `sdd-router`, `ask-first`, `graph-first` (`UserPromptSubmit`) | clasifican el pedido y le dicen al agente qué ruta seguir: spec primero, test rojo primero, una pregunta antes de tocar archivos, el índice antes que abrir archivos |
| **Freno** — decidido, no ejecutado | `protected-paths`, `bash-guard`, `reuse-guard`, `action-guard` (`PreToolUse`) | deniegan con exit 2 y un `reason` que explica por qué y qué hacer en su lugar |
| **Sensor** — después del acto | `post-edit-check` (`PostToolUse`) | corre el lint **sobre el archivo recién tocado** |
| | `gate-stop` (`Stop`) | no deja cerrar la tarea con el gate sucio |
| | `.githooks/` (`pre-commit`, `commit-msg`, `pre-push`), CI | el mismo gate, en los otros dos lugares donde el trabajo sale |
| | subagente `reviewer` | juicio sobre lo que ninguna regla ve |

**Sensores escritos para un modelo.** El artículo insiste en que un sensor rinde más cuando su
salida está pensada para que un LLM se corrija solo — un mensaje de linter que incluye la
instrucción de arreglo. Es la regla de estilo de este repo: *los mensajes de bloqueo explican el
porqué*. Cada `reason` del config dice qué pasó, por qué importa y qué hacer; es lo único que el
agente lee cuando lo frenás (P5).

## 2. Computacional e inferencial

La segunda partición es por **quién ejecuta** el control:

| | Computacional | Inferencial |
|---|---|---|
| Qué es | determinista, en CPU, milisegundos a segundos | un modelo que juzga: no determinista, caro, semánticamente rico |
| Qué atrapa bien | estructura: imports, patrones, rutas, formato | intención, diseño, "esto no se hace así acá" |
| Cuándo correrlo | en cada edición y cada commit | cuando el costo se justifica |

La constitución **ya está escrita con esta partición**, con otro nombre: un principio BLOCKING
nombra el comando que falla (computacional); uno REVIEW lo evalúa el `reviewer` (inferencial).
La regla de la constitución —*si no se puede nombrar el comando, es REVIEW*— es la forma de no
disfrazar un control inferencial de determinista.

| Tipo | Guía | Sensor |
|---|---|---|
| **Computacional** | los perfiles de stack del instalador (`plantillas/perfiles/`); el ruteo por regex de `sdd.routes` | `repo-lint` (ocho clases de regla), `harness-selftest`, `docs-linkcheck`, `artifacts-check`, los hooks de git |
| **Inferencial** | `CLAUDE.md`, las skills, los comandos (`/lesson`, `/harness-port`) | `reviewer`; P12 y P14 de la constitución |

El sesgo es deliberado: **todo lo que se pueda volver computacional, se vuelve** (P13: test >
hook/lint > comando > markdown). El control inferencial queda para lo que de verdad necesita
juicio, y se declara como tal.

## 3. Qué se regula: mantenibilidad, arquitectura, comportamiento

El artículo distingue tres arneses según lo que regulan. Cada uno tiene una madurez distinta, acá
y en la industria:

**Mantenibilidad — el más fácil, y el más cubierto.** Las clases de regla del lint son exactamente
sensores computacionales de calidad interna: regla de capa, de patrón, de fuente única
(`singleSource`), invariante, reutilización (`reuse`), dependencias prohibidas (`forbiddenDeps`).
`post-edit-check` las corre en el momento más barato posible: el archivo que se acaba de tocar.

**Aptitud arquitectónica — *fitness functions*.** Una característica de arquitectura declarada con
un comando que la mide. Ejemplos acá:

- `scripts/hooks-timing.mjs` es una *fitness function* de manual: la latencia de cada hook contra
  su presupuesto (`observability.budgetMs`). La regla PUREZA se defendía con una intuición; ahora
  se defiende con un número.
- acoplamiento y cohesión traducidos a reglas que fallan: [arquitectura.md](arquitectura.md).
- el banco (`scripts/harness-bench.mjs`) mide que un perfil **encaje** en un repo real de su stack,
  no sólo que tenga la forma correcta.

**Comportamiento — "el elefante en la habitación".** Que el código haga lo que tiene que hacer. El
artículo es franco: la respuesta típica (spec como guía, tests generados por IA como sensor) le
pone demasiada fe a tests que escribió el mismo agente. Lo que este arnés hace cumplir es **la
forma** del proceso, no su calidad:

- ruta `sdd`: spec, plan y tareas antes de producción ([sdd.md](sdd.md));
- ruta `bugfix`: test rojo antes del arreglo;
- `xp.testFirst`: el commit que cambia comportamiento trae su prueba, o declara `no-test: <motivo>`.

- `xp.testFirst.verifyRed`: en CI, sobre el PR, las pruebas de la rama tienen que **fallar sobre
  la base**, sin el cambio de producción (`node scripts/cycle-check.mjs --verify-red <base>`). Una
  prueba que pasa igual es un espejo del código, y el paso sale rojo.

Eso convierte "¿la prueba prueba algo?" en un comando. Lo que sigue sin verificar nada es que falle
por la razón **correcta**. Ver la sección 8.

## 4. La calidad a la izquierda: dónde va cada control

"Cuanto antes aparece el problema, más barato es arreglarlo." El artículo reparte los controles
por costo a lo largo del ciclo del cambio. El mapa de este arnés:

| Etapa | Costo | Control |
|---|---|---|
| el pedido | ~0 | `sdd-router`, `ask-first`, `graph-first` |
| la acción decidida | ms | `protected-paths`, `bash-guard`, `reuse-guard`, `action-guard` |
| la edición hecha | ~100 ms | `post-edit-check` (lint del archivo) |
| fin del turno | el gate | `gate-stop` |
| commit / push | barato | `pre-commit`, `commit-msg`, `pre-push` (el gate completo no corre acá) |
| integración | el gate, en limpio | CI (`.github/workflows/ci.yml`) — el mismo `npm run gate`, más `--verify-red` en el PR |
| continuo (deriva) | semanal | `.github/workflows/drift.yml`: el gate sobre main, `npm run drift` y `npm run eval:reviewer` |

`npm run map` imprime este mismo mapa **desde el config** (`taxonomy`), pieza por pieza, con su
dirección y su tipo; una pieza nueva que nadie ubicó es rojo.

Dos reglas propias que el artículo no dice y que salieron de incidentes:

- **Cada etapa tiene presupuesto.** Un hook que corre en cada prompt no puede costar lo que cuesta
  el gate; por eso sólo dos hooks lanzan procesos (`purity.except`) y `npm run timing` lo mide.
- **La etapa temprana no reemplaza a la tardía.** `gate:fast` verde no es verde (P1): lo que se
  saltea por velocidad a la izquierda se paga completo a la derecha.

## 5. *Harnessability*: el repo que se deja gobernar

No todo repo es igual de fácil de embridar. El artículo llama *affordances ambientales* a las
propiedades del entorno que lo hacen legible y navegable para un agente: tipos fuertes, límites de
módulo claros, frameworks establecidos. La consecuencia incómoda: *el arnés hace más falta donde
más cuesta construirlo* — en el código heredado.

Lo que este arnés aporta a la legibilidad del repo, más allá del lenguaje:

- **el índice del código es obligatorio** ([codegraph.md](codegraph.md)): símbolos, llamadas y
  radio de impacto sin abrir archivos. Es una *affordance* fabricada.
- **los perfiles de stack** declaran los hechos del lenguaje (qué es código, cómo se escribe un
  import, dónde vive el manifiesto) para que las reglas agnósticas tengan de qué agarrarse
  ([perfiles.md](perfiles.md)).
- **para lo heredado**, `examples/legacy-brownfield.json` y la receta de [portar.md](portar.md):
  pocas reglas, cada una con su cicatriz, en vez de importar las de otro repo.

## 6. Plantillas de arnés y la ley de Ashby

El artículo anticipa que las organizaciones con pocas topologías de servicio van a converger en
**plantillas de arnés**: guías y sensores preempaquetados por tipo de sistema. Y advierte el mismo
riesgo que las plantillas de servicio: deriva de versiones, y contribuciones que no vuelven.

Acá esa idea existe, con un límite explícito:

- `plantillas/perfiles/` + `examples/` + `scripts/harness-init.mjs` son plantillas de arnés.
- pero **un perfil lleva la forma del lenguaje y nunca reglas** (P14): `profiles.forbiddenKeys` y
  la regla `PERFIL` del lint lo hacen cumplir. Las reglas son las cicatrices de un repo; en otro son
  ruido que gasta contexto.
- la deriva entre N repos está tratada en [multi-proyecto.md](multi-proyecto.md).

**Ashby.** *Un regulador necesita al menos tanta variedad como el sistema que gobierna, y sólo
regula aquello de lo que tiene un modelo.* En este arnés, el modelo es
`.claude/harness.config.json` (P4): los hooks no saben nada del repo, así que regulan exactamente
lo que el config describe y nada más. Comprometerse con pocas topologías es **reducir la variedad**
del sistema para que el regulador alcance; declarar el repo en un JSON es darle el modelo.

## 7. El lugar del humano

Un desarrollador trae un arnés implícito que el agente no tiene: convenciones absorbidas, rechazo
estético a una función de 300 líneas, el "acá no lo hacemos así", responsabilidad social, memoria
de la organización. El artículo no propone eliminar al humano sino **dirigir su atención a donde
más importa**.

Cómo lo hace este arnés:

- **fugas humanas, a la vista.** `no-issue: <motivo>`, `no-test: <motivo>`, `big-batch:
  <motivo>`: saltarse una regla es posible, pero queda firmado en el historial, donde un humano lo
  revisa.
- **el marcador de `ask-first` lo limpia el próximo pedido del usuario**: la salida es humana a
  propósito.
- **rutas protegidas con excepción humana** (P8): la guía de fondo se enmienda cuando la pide el
  humano y el cambio lo hace él.
- **`/lesson`** convierte el juicio del humano sobre un incidente en un mecanismo, para no tener
  que ejercerlo dos veces.

## 8. Las preguntas abiertas del artículo, contestadas o declaradas

| Pregunta abierta | Respuesta de este arnés | Estado |
|---|---|---|
| ¿Cómo mantener **coherentes** guías y sensores cuando el sistema crece? | una sola fuente: el hook y el `pre-commit` leen la misma lista del config; el self-test **deriva sus casos del config** ([0003](decisions/0003-selftest-generado.md)); y la regla `COHERENCIA` del lint (`coherence`): lo que una guía recomienda en un bloque de shell, o un `reason` ofrece como salida, no puede estar en `bash.deny`. Su primera corrida cazó a `/code-index` recomendando bajar y ejecutar un instalador remoto en un solo paso | cubierto |
| ¿Cómo evaluar la **cobertura** del arnés, como se mide la cobertura de código? | `harness-selftest`: cada regla del config bloquea una muestra derivada de ella, y cada freno prueba que **no** muerde lo inocente (P2, P3); `/harness-audit` pregunta, por regla, qué comando falla; `npm run map` ubica cada pieza y muestra las etapas sin control | cubierto |
| ¿Cuánto **cuesta** el arnés? | `npm run timing` contra presupuesto por hook | cubierto |
| ¿Qué hace el agente cuando **dos instrucciones chocan**? | la constitución (1.2.0) ordena la precedencia entre BLOCKING —P8/P9, después P5, después P1— y exige **parar y escalar**, no elegir en silencio | declarado (REVIEW): ningún comando ve el choque |
| ¿Cómo se prueba un control **inferencial**? | `npm run eval:reviewer`: diffs con una violación conocida y diffs inocentes, una **tasa** contra `reviewerEval.minScore`, fuera del gate (caro, no determinista), en el barrido semanal. El self-test prueba la máquina del eval con revisores de mentira | cubierto, con tasa y no con certeza |
| **Comportamiento** con suficiente confianza como para supervisar menos | además de la forma (prueba junto al cambio), `--verify-red` en el PR: la prueba tiene que fallar sin el cambio. Que falle por la razón correcta, mutation testing y *approved fixtures* siguen siendo del repo destino | cubierto a medias |
| **Deriva continua** (código muerto, dependencias, cobertura que se degrada) | `.github/workflows/drift.yml`, semanal: el gate sobre main sin cambios, `npm run drift` (un STATUS vencido es rojo; una regla que nunca cazó nada en el historial es aviso) y la prueba del revisor. Código muerto y dependencias son del stack del repo destino | cubierto para el arnés |

Lo que queda abierto está escrito en la columna de estado para que nadie lo asuma cubierto. Cada
mecanismo nuevo de esta tabla entró con su caso en el self-test (secciones 4e-bis, 3f-ter y 10).

---

Ver también: [metodo.md](metodo.md) (el ciclo y las leyes), [agilidad.md](agilidad.md) (qué
principio ágil tiene mecanismo), [arquitectura.md](arquitectura.md) (*fitness functions* de
acoplamiento), [arnes.md](arnes.md) (el arnés de este repo, señal por señal),
[buenas-practicas.md](buenas-practicas.md) (la guía de fondo).

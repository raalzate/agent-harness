# El panel del arnés

Una página HTML autocontenida que contesta de un vistazo tres preguntas: **¿el arnés está vivo?**,
**¿qué dice la memoria del repo?** y **¿qué pasó de verdad en esta máquina?**. Sin dependencias, sin
red (salvo las sondas a `localhost` que declares), sin ningún modelo de lenguaje: se deriva de los
archivos que el arnés ya exige y del registro que el gate escribe.

```bash
node scripts/panel/generar.mjs           # lo escribe en .git/harness-panel/index.html
node scripts/panel/sincronizar.mjs       # lo mismo, pero sólo si algo cambió
```

**Se genera siempre.** `scripts/gate.mjs` lo regenera al final de **cada** corrida, verde o roja,
así que el panel nunca es más viejo que el último gate. Un panel que hay que acordarse de
regenerar es un panel viejo: dice «verde» de anteayer y nadie sabe que está mirando una foto.
El gate lo corre como proceso hijo, con tiempo límite (`panel.timeoutMs`), e ignora su exit code: si no se pudo generar lo dice, y el veredicto no cambia —ni un panel que sale con 0 vuelve verde a un gate rojo, ni uno colgado cuelga al gate—. Lo que
verifica que el panel genere es el self-test (sección 11).

![El panel de un repo real recién portado: cero alarmas, último gate rojo en esta máquina contra un veredicto en prosa verde, plan al 100 %](https://raw.githubusercontent.com/raalzate/agent-harness/main/docs/img/panel-cabecera.png)

## Qué muestra

| Pestaña | De dónde sale | Qué contesta |
|---|---|---|
| **Salud** | `taxonomy`, `install.activators`, `.claude/settings.json`, `gate.signals`, toda clave con `runner`, `.claude/agents`, `.claude/commands`, `.claude/skills` | ¿cada pieza instalada está viva? El mapa guía/freno/sensor por etapa (la misma función que `node scripts/harness-map.mjs`), los frenos instalados sin la clave que los enciende («instalado y muerto»), los hooks que no existen, las señales sin `why`, los controles fuera del gate sin nadie que los corra |
| **Memoria** | las guías (`CLAUDE.md` y sus `@imports`, la del usuario, las de arriba y la local), `.claude/skills` · `agents` · `commands` del repo y del usuario, la memoria automática de esta máquina, las transcripciones, `docs/decisions/` | la memoria del agente como LLEGA: qué lee al arrancar y cuánto pesa, qué entra sólo cuando algo lo dispara y cuánto se usó, qué recuerda esta máquina y si todavía apunta a algo que existe (ver abajo) |
| **Ahora** | git, `gate.marker`, `gate.registry`, `panel.probes`, `panel.tracker`, las transcripciones locales | lo que corrió EN ESTA MÁQUINA: la última corrida del gate señal por señal (con su último verde y el HEAD sobre el que valió), si hay código editado sin gate, el árbol de cada repo, los servicios locales, qué dice hoy el gestor de los ítems que la memoria cita, cuántos tokens se gastaron |
| **Plan** | `tracker.artifactsIn` → las casillas del plan en la historia de git, o las fechas de los ítems del gestor | el burn-down: alcance, hecho y pendiente en el tiempo, con la línea ideal si hay fecha objetivo. Sin fuente, OMITIDO (ver abajo) |
| **Estado** | `status.file` | la prosa verificada, con su fecha: veredicto, señales, bloqueos, deuda |
| **Gotchas** | `incidents.file` | cada incidente con su mecanismo; un puntero muerto sale en rojo |
| **Reglas** | `sources.constitutions`, el config | los principios con su fuerza y su mecanismo, las señales del gate, cada freno declarado, el ciclo de desarrollo |
| **Fuentes** | — | qué archivo alimentó el panel, su hash, y las advertencias de formato |

Toda alarma de la pestaña Salud **nombra el comando que ya la pone en rojo**: el panel no inventa
criterios, muestra los que un freno ya hace cumplir.

La prosa y la máquina van en pestañas distintas a propósito. «STATUS dice verde» y «el gate salió
verde acá, hace diez minutos, sobre este HEAD» son datos distintos, y confundirlos es el defecto
que el panel existe para no tener. Una señal sin registro no se pinta verde: se dice que no corrió
en esta máquina.

## Dónde se escribe, y por qué

Por defecto en `.git/harness-panel/` (`panel.out`). El arnés no escribe en el árbol de fuentes
(P7): un watcher vivo vería aparecer y desaparecer archivos. `.git/` existe en todo repo, ningún
watcher lo mira y ningún `.gitignore` necesita nombrarlo. En un worktree, donde `.git` es un
archivo, se resuelve el `gitdir` real.

En CI se publica como artefacto (`.github/workflows/ci.yml`, paso `panel`): el mismo HTML que ve
el desarrollador, adjunto a cada corrida.

## Portarlo a otro repo

No hay nada que portar: sin la clave `panel` sale igual, con defaults que se deducen de claves que
el arnés ya tiene (`status.file`, `incidents`, `tracker.issuePattern`, `tests.filePattern`,
`docs.proseRoots`). Lo que conviene declarar (cada clave, en la referencia del config del arnés, sección `panel`):

- **`panel.tasks`** — cómo se invoca una tarea en tu stack. Con esto, el panel verifica que las
  tareas que cita la memoria existan en el manifiesto. Sin esto no extrae ninguna: adivinar el
  ejecutor de tareas de otro lenguaje es cablear un lenguaje.

  | Stack | `tasks` |
  |---|---|
  | Node | `{ "manifest": "package.json", "key": "scripts", "invocation": "npm run" }` |
  | Make / just / Gradle | `{ "invocation": "make" }` — sin manifiesto JSON, se muestran sin verificar |

- **`panel.repos`** — en un monorepo o una plataforma de varios repos, los árboles hermanos que se
  muestran junto a la raíz.
- **`panel.probes`** — los servicios locales que tu equipo levanta (`http://localhost:…/health`).
- **`panel.tracker.command`** — para que las citas a ítems de trabajo muestren su estado de hoy.

## El burn-down: depende de dónde viva el plan

![Burn-down de un plan que vive en GitHub: el alcance creció de 101 a 229 tareas, todas cerradas](https://raw.githubusercontent.com/raalzate/agent-harness/main/docs/img/panel-burndown.png)

Se calcula en el panel a partir de fechas que ya están en los datos, así que no depende de ninguna
herramienta: cada fuente sólo tiene que dar ítems con fecha de alta y de cierre. Qué fuente se usa
lo decide `tracker.artifactsIn` (o `panel.plan.source`):

| Caso | De dónde sale | La serie |
|---|---|---|
| **el plan vive en el repo** | las casillas `- [ ]` / `- [x]` de `panel.plan.files` (default `<specsDir>/**/tasks.md`) | un solo `git log --first-parent` de la rama base: cada commit suma o resta las casillas que su diff agrega o quita. Versionado: la misma serie para todo el equipo. Lo tildado y no commiteado se muestra aparte, sin fecha |
| **el plan vive en el gestor** | los ítems de `panel.tracker.command` con `createdAt` y `closedAt` | alta = suma alcance ese día; cierre = suma hecho ese día. Es la misma respuesta que usan las citas: ninguna llamada de más |
| **no hay plan** | — | **OMITIDO** con su motivo. Un plan vacío y uno que no existe no se pueden ver igual |

**Cero costo y determinista:** la serie usa las fechas de los datos —la del commit, la del ítem—,
nunca la de hoy. Con el mismo HEAD (o la misma respuesta del gestor), el mismo burn-down, en
cualquier máquina. Se dibuja como SVG dentro del HTML, sin librerías.

Con `panel.plan.dueDate` se dibuja la línea ideal; sin fecha objetivo no se inventa ritmo. El panel
dice lo que el número NO afirma: es conteo de ítems y no esfuerzo, hecho no es entregado, y un
alcance que crece se ve crecer en vez de esconderse como avance que baja.

## La memoria: como llega, no como está escrita

Las fuentes versionadas (STATUS, gotchas, constitución) son lo que el arnés EXIGE. La memoria es
otra cosa: lo que el agente lee sin que nadie se lo pida. La pestaña la ordena por cómo llega (ADR
0010):

| Capa | Qué muestra | Sensor |
|---|---|---|
| **Al arrancar** | cada pieza que entra en CADA sesión —guías con sus `@imports`, el índice de la memoria automática (sus primeras 200 líneas), las descripciones de skills, subagentes y comandos, lo que imprime el hook de sesión— con quién la ve y ≈tokens | `memory.injectBudgetTokens`: más que eso es ruido que compite con el pedido. El total es un PISO: el prompt del sistema, las herramientas, MCP y los plugins no se ven desde el repo |
| **Selectiva** | el cuerpo de cada skill, subagente y comando (lo que cuesta al dispararse), lo que pueden inyectar los hooks de pedido, los documentos que la guía cita, las guías de subcarpeta | cuántas veces se usó cada pieza en la ventana, leído de las transcripciones de este repo en esta máquina: una pieza cara sin uso ACÁ merece una revisión |
| **Personal** | la memoria automática de Claude Code en esta máquina: cada entrada con su tipo, su edad, sus lecturas y las rutas del repo que cita | rutas que no resuelven contra lo que git versiona (¿vencida, abreviada o de otro repo? el panel no afirma cuál), entradas que el índice no anuncia |
| **Versionada** | los ADR con su estado | un estado que no se lee |

![Pestaña Memoria: lo que el agente lee al arrancar, pieza por pieza, con quién la ve y ≈tokens](https://raw.githubusercontent.com/raalzate/agent-harness/main/docs/img/panel-memoria.png)

![Memoria selectiva: skills, subagentes y comandos con su costo fijo y al dispararse, y cuánto se usaron](https://raw.githubusercontent.com/raalzate/agent-harness/main/docs/img/panel-selectiva.png)

**Qué se ejecuta y qué no.** Para saber qué inyecta el hook de sesión hay que correrlo, y eso es
ejecutar código del repo en cada gate: es opt-in (`memory.runSessionHooks: true`), sólo los hooks
de arranque, sólo `node <script>` del repo. Los hooks de PEDIDO no se ejecutan nunca —uno puede
escribir el marcador de `ask-first`—: lo que inyectan se mide desde el config con
`memory.promptSources` (`[{ hook, key }]`), y un hook sin fuente declarada figura «no medido».

**Qué es de quién.** Lo versionado lo ve el equipo; lo del home, lo ignorado por git y la memoria
automática, sólo esta máquina. Si una regla importante vive en la segunda columna, en otra máquina
no existe. Los tokens son una estimación (caracteres / 4) y así se dicen.

## El gestor de trabajo, sin conocer ninguna forja

El panel extrae de la memoria dónde se cita un ítem (con `tracker.issuePattern`: `#123`, `AB#123`,
`PROJ-123`). Qué dice HOY ese ítem lo pregunta a un comando que declara el repo: recibe los ids
citados como argumentos y devuelve por stdout

```json
{ "items": [{ "id": "#12", "title": "…", "state": "closed", "url": "https://…", "type": "issue",
               "createdAt": "2026-09-01", "closedAt": "2026-09-04" }],
  "summary": { "total": 40, "closed": 31 } }
```

`inPlan: false` marca un ítem que viene sólo porque la memoria lo cita: se muestra en las citas y no
cuenta como alcance del burn-down (default `true`). `summary` es opcional (el avance del tablero, que es conteo y no esfuerzo). `closedStates` dice qué
estados cuentan como cerrados. Si el comando falla, el panel lo dice con el error: un gestor vacío
y uno inalcanzable no se pueden ver igual.

El adaptador es del repo y no del arnés, porque ningún script del arnés conoce una forja. Con
GitHub, por ejemplo, alcanza con un script de diez líneas sobre `gh issue view <n> --json
number,title,state,url` que arme esa forma.

## Lo que NO hace

- **No bloquea nada.** Es un sensor para mirar, no un freno. `--verificar --estricto` lo arma sin
  escribir y sale con 1 si no genera o si hay alarmas, para quien lo quiera como señal del gate (así
  lo usa un repo cuyo self-test no cubre el panel); este repo no lo usa así porque cada alarma ya tiene
  su comando rojo en el gate.
- **No es del equipo.** Tokens, registro del gate y árbol de trabajo son de esta máquina. El
  artefacto de CI es el de esa corrida.
- **No lee el gestor sin permiso.** Sin `panel.tracker.command` no hay red hacia ninguna forja.

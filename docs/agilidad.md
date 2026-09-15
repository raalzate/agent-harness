# Los principios ágiles que este arnés exige

No hay ceremonia acá: ni estimaciones, ni tableros, ni nombres de marco. Lo que queda es la parte
que se puede **hacer cumplir con un comando**, que es la única que sobrevive a una semana con
prisa. Los demás principios ágiles siguen valiendo — pero se declaran como lo que son: juicio.

| # | Principio | Cómo se ve cuando falta | Mecanismo | Fuerza |
|---|---|---|---|---|
| 1 | **Software funcionando es la medida del avance** | "está listo, sólo falta probarlo" | `gate.command`: el entregable es el gate verde, no la opinión de quien lo escribió. El hook `Stop` no deja cerrar la tarea con el gate sucio | BLOQUEA |
| 2 | **Lote chico** | un PR de 40 archivos que nadie revisa de verdad | `xp.smallBatch`: archivos y líneas del commit contra el límite de ESTE equipo, con fuga declarada (`lote-grande: <motivo>`) — más `branches.protected` y el gate en cada push | BLOQUEA |
| 3 | **El trabajo es visible** | "¿esto por qué se cambió?" y el historial no contesta | `.githooks/commit-msg`: un commit que toca código referencia su ítem (`tracker.issuePattern`) o declara `sin-issue: <motivo>` en su línea | BLOQUEA |
| 4 | **Una sola fuente del trabajo** | la spec en el repo, las tareas en el gestor, ninguna al día | `tracker.artifactsIn` + `node scripts/artifacts-check.mjs` en el gate | BLOQUEA |
| 5 | **Integración continua de verdad** | la rama que vive tres semanas y se mergea a ciegas | CI corre **el mismo** gate en cada push y cada PR ([cicd.md](cicd.md)) | BLOQUEA |
| 6 | **Definición de Hecho única** | cada quien tiene la suya | el gate **es** la Definición de Hecho, y está escrita en un archivo: `gate.signals`, cada señal con su `why` | BLOQUEA |
| 7 | **Retrospectiva con consecuencia** | la misma falla, la tercera vez, con el mismo "hay que acordarse" | `/lesson`: el incidente termina en el mecanismo más fuerte disponible, y la regla `INCIDENTE` exige que cada gotcha declare su **Mecanismo:** | BLOQUEA |
| 8 | **Ritmo sostenible** | el gate tarda quince minutos y la gente empieza a saltearlo | `fastSkip` / `skipIfMissing` y la revisión del `why` de cada señal; si el gate estorba, **se arregla el gate** (saltearlo está en `bash.deny`) | REVIEW |
| 9 | **Requisitos que cambian, bienvenidos** | el refactor que nadie se anima a hacer | acoplamiento bajo verificado por comando ([arquitectura.md](arquitectura.md)): cambiar es barato cuando el límite está escrito, no recordado |  REVIEW |
| 9b | **Un ciclo de desarrollo, no quince** | cada quien nombra las ramas como quiere y el agente commitea donde cayó | `workflow`: el modelo declarado (`model`), el nombre de rama verificado en `pre-push` y la edad de la rama medida contra `baseBranch` ([ciclo-desarrollo.md](ciclo-desarrollo.md)) | BLOQUEA |
| 9c | **El cambio entra con su prueba** | "después le agrego el test" | `xp.testFirst`: el commit que cambia comportamiento trae un archivo de prueba, o declara `sin-test: <motivo>` | BLOQUEA |
| 10 | **Conversación antes que documento** | el agente adivina y entrega otra cosa | el hook `ask-first` (una pregunta se contesta, no se ejecuta) y la ruta `clarify` del router: ante un pedido ambiguo, **una** pregunta antes de tocar archivos | BLOQUEA a medias |

## Las tres que la gente se saltea

**El ítem antes del código, no después.** El router lo dice en cada pedido que cambia código:
preguntá si se registra el ítem **antes** de tocar producción. Registrarlo al final es escribir la
historia para que dé bien.

**Una falla se reproduce antes de arreglarse.** Ruta `bugfix`: test rojo primero. Un arreglo sin
test rojo previo no tiene cómo demostrar que arregló algo.

**El refactor va en su propio commit.** `xp.refactorSeparate`: un commit que se declara
`refactor:` no cambia pruebas — si cambian las expectativas, no era un refactor. Mezclarlos es lo
que hace imposible revertir uno solo.

**Feature no es "ponerse a escribir".** Ruta `sdd`: spec, plan y tareas antes de producción — y si
se decide saltar la ruta, **se declara en una línea con el porqué**. El silencio es el hallazgo,
no la decisión (ver [sdd.md](sdd.md)).

## Lo que este arnés NO hace cumplir

Y conviene decirlo, porque un documento que promete todo no se cree nada:

- que el ítem de trabajo esté **bien escrito** (una feature con su ítem madre y sus tareas, no un
  bug suelto): juicio del `reviewer`;
- que el lote sea chico **de verdad**: `xp.smallBatch` cuenta archivos y líneas contra el límite
  que este equipo escribió, y no sabe si el lote tiene sentido propio;
- que el refactor sea de verdad un refactor, ni que la prueba se haya escrito **antes** (lo
  verificable es que entren juntas al historial), ni que la sesión de a dos haya existido detrás
  del `Co-authored-by:` — las cuatro son juicio del `reviewer` ([ciclo-desarrollo.md](ciclo-desarrollo.md));
- a qué rama se mergea cada cambio: `workflow.mergeInto` se **declara** y no se finge verificado,
  porque lo decide el pull request y el hook no lo ve;
- que la retrospectiva se haga; sólo que **si** se hace, deje mecanismo;
- nada sobre estimaciones, velocidad o puntos. No hay comando que los haga verdaderos.

---

Ver también: [ciclo-desarrollo.md](ciclo-desarrollo.md) (el modelo de ramas y las prácticas de XP),
[trazabilidad.md](trazabilidad.md) (el registro, en cualquier forja),
[cicd.md](cicd.md) (integración continua), [sdd.md](sdd.md) (cuándo el trabajo arranca con spec),
[buenas-practicas.md](buenas-practicas.md) (la guía de fondo).

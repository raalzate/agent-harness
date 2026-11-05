# Índice de la biblioteca

> GENERADO por `node scripts/library.mjs index`: no se edita a mano. Lo consulta el subagente
> `librarian`; lo verifica la señal del gate `library index (docs)`.

42 entradas en 6 bases · 42 documentos (no estructurado) · 0 tablas · 0 grafos (estructurado).

## Bases de conocimiento

| Base | Concepto | Qué NO entra | Entradas |
|---|---|---|---|
| [metodo](#metodo) | Por qué existe el arnés: la teoría, el método y la evidencia | cómo se instala, cómo se configura, decisiones puntuales | 5 |
| [diseno](#diseno) | Decisiones de diseño: arquitectura y ADR, con su porqué | la teoría general (metodo) y el uso diario (flujo) | 17 |
| [instalacion](#instalacion) | Instalar y portar el arnés en otro repo, stack o plataforma | el trabajo diario una vez instalado (flujo) | 5 |
| [flujo](#flujo) | El ciclo de trabajo: ramas, registro, SDD, CI/CD, despliegue y worktrees | cómo funciona cada pieza del arnés por dentro (referencia) | 6 |
| [referencia](#referencia) | El arnés por dentro: claves del config, señales, índices, panel, evaluaciones y recetas | el porqué de fondo (metodo) y los incidentes (incidentes) | 8 |
| [incidentes](#incidentes) | Incidentes reales del arnés en formato fijo: síntoma, causa, regla, mecanismo | decisiones de diseño tomadas sin incidente (diseno) | 1 |

## metodo

**Por qué existe el arnés: la teoría, el método y la evidencia**

| Entrada | Tipo | Qué contiene |
|---|---|---|
| [Los principios ágiles que este arnés exige](agilidad.md) | documento | No hay ceremonia acá: ni estimaciones, ni tableros, ni nombres de marco. Lo que queda es la parte que se puede hacer cumplir con un comando, que es la única que sobrevive a una semana con prisa. Los demás principios ági… |
| [Ingeniería de Arnés (Agent Harness) — Buenas prácticas para cualquier proyecto de software](buenas-practicas.md) | documento | --- |
| [Caso de estudio — un arnés real, con números](caso-de-estudio.md) | documento | El método de metodo.md no se inventó en abstracto: salió de montarlo sobre un producto concreto y ver qué aguantaba. Este documento es esa evidencia. |
| [Guías y sensores — el marco de *harness engineering*, aplicado a este arnés](guias-y-sensores.md) | documento | Fuente: Birgitta Böckeler, Harness engineering for coding agent users (martinfowler.com, abril de 2026). Este documento no lo resume: toma su vocabulario y lo usa para contestar una pregunta concreta — de cada idea del… |
| [El método — ingeniería de arnés en la práctica](metodo.md) | documento | buenas-practicas.md explica por qué existe un arnés y de qué partes se compone. portar.md da la receta para instalar uno. Este documento es lo que queda en el medio: el método de trabajo, las leyes que lo gobiernan, y c… |

## diseno

**Decisiones de diseño: arquitectura y ADR, con su porqué**

| Entrada | Tipo | Qué contiene |
|---|---|---|
| [Arquitectura: qué se documenta, y cómo se mide el acoplamiento](arquitectura.md) | documento | Dos cosas distintas viven acá, y conviene no mezclarlas: |
| [ADR 0001 — La especificidad del repo va en un JSON, y el gate es declarativo](decisions/0001-arnes-portable.md) | documento | agnóstica de stack) |
| [ADR 0002 — El arnés corre con node y bash, sin dependencias](decisions/0002-sin-dependencias.md) | documento | El arnés tiene que instalarse en repos de cualquier ecosistema: TypeScript, Python, Go, Java, un monorepo, un repo de infraestructura sin ningún lenguaje de aplicación. Cada dependencia que agregue es una negociación co… |
| [ADR 0003 — El self-test genera sus casos desde el config](decisions/0003-selftest-generado.md) | documento | Un arnés se degrada por una vía específica: alguien agrega una regla, la regla nunca se prueba, y seis meses después ya no bloquea nada. El archivo está ahí, el config la declara, y en la práctica es decorativa. Es el a… |
| [ADR 0004 — El contrato de los hooks, y por qué un arnés roto deja pasar](decisions/0004-contrato-de-hooks.md) | documento | Los hooks son el único componente del arnés que corre dentro del ciclo del agente, y su interfaz es angosta a propósito: entra JSON por stdin, y lo único que sale es un código de salida más un texto. Sobre eso hay que d… |
| [ADR 0005 — El índice del código es obligatorio, y viaja como señal del gate](decisions/0005-indice-obligatorio.md) | documento | El arnés traía el hook graph-first.mjs desde el principio y la guía de fondo recomendaba "consultar el índice antes de abrir archivos". Dos hechos incómodos: |
| [ADR 0006 — El banco corre en procesos hijos, y el contrato entre padre e hijo es la salida](decisions/0006-banco-en-paralelo.md) | documento | npm run gate tardaba 119s con diez núcleos al 88% de uno (mediana de 3 corridas en un clone limpio; una sola corrida varía ±6s). Medido señal por señal: el banco 69s, el self-test 43s, el resto ~4s. Dentro del banco, un… |
| [ADR 0007 — Los controles caros o que dependen del reloj van fuera del gate, con quien los corra](decisions/0007-controles-fuera-del-gate.md) | documento | Adaptar el marco de guías y sensores (guias-y-sensores.md) dejó tres huecos que un comando podía cerrar, pero ninguno cabía en el gate de cada commit: |
| [ADR 0008 — El trabajo tiene foco: un objetivo en memoria, mapeado al tablero](decisions/0008-foco.md) | documento | P11 garantiza que cada commit apunte a un ítem del tablero. No garantiza que los ítems apunten a un mismo objetivo. Un agente puede cerrar cinco issues impecablemente registradas en una sesión y no haber avanzado un mil… |
| [ADR 0009 — El gate regenera el panel del arnés en cada corrida, sin que el panel decida nada](decisions/0009-panel-del-arnes.md) | documento | Para saber si el arnés estaba vivo había que correr cinco comandos (map, lint:rules, timing, el self-test, leer STATUS) y juntar las salidas a mano. STATUS.md es prosa con fecha: dice «verde» aunque lo último que corrió… |
| [ADR 0010 — El panel muestra la memoria como LLEGA al agente, y sólo ejecuta lo que el config permite](decisions/0010-memoria-como-llega.md) | documento | El panel mostraba las FUENTES que el arnés exige (STATUS, gotchas, constitución, config), y las llamaba «memoria». Pero la memoria del sistema es otra cosa: lo que el agente lee sin que nadie se lo pida, por qué capa y… |
| [ADR 0011 — El ciclo acotado lo cuenta el gate y lo destraba el humano](decisions/0011-ciclo-acotado.md) | documento | P12 pedía «2 intentos sobre el mismo error; al tercero se para y se escala», pero era REVIEW: el gate lo imprimía y nadie lo contaba. Peor, el hook Stop bloqueaba cerrar con el gate rojo, así que el único camino que le… |
| [ADR 0012 — El arnés autoriza UN camino de despliegue, y sólo esa forma exacta](decisions/0012-el-arnes-autoriza-un-camino.md) | documento | Hasta acá los hooks del arnés sólo hacían tres cosas: dejar pasar callados, bloquear (exit 2) o pedirle el sí al humano (ask). Ninguno otorgaba un permiso. Desplegar mostró por qué hacía falta: Claude Code frena en bloq… |
| [ADR 0013 — La tarea declarada: el agente planifica, el arnés verifica que terminó](decisions/0013-tarea-declarada.md) | documento | El gate dice si el repo está sano, pero no sabe qué se pidió. «Terminé» era entonces la palabra del agente: nada impedía salirse de la tarea «de paso» ni declarar listo lo que no cumplía el criterio de aceptación. El mo… |
| [ADR 0014 — El self-test corre en abanico, y el grupo es la frontera del estado](decisions/0014-selftest-en-abanico.md) | documento | Después de 0006 el banco corría en paralelo, pero el gate seguía siendo, casi entero, arranque de procesos en serie (#32). Medido por dentro, con un perfilador de spawnSync por línea de llamada: |
| [ADR 0015 — promptfoo evalúa a los subagentes como corredor, no como dependencia](decisions/0015-promptfoo-como-corredor.md) | documento | La prueba de vida del reviewer (scripts/reviewer-eval.mjs) corre cada caso una vez y sólo lee el veredicto. Una corrida con promptfoo y --repeat 3 destapó lo que eso esconde: el caso inocente «una regla nueva con su mot… |
| [ADR 0016 — La documentación se indexa por tipo y se ubica por concepto](decisions/0016-biblioteca.md) | documento | El código tiene índice (codegraph, ADR 0005); la documentación no. Para contestar «qué dice la doc sobre X» el agente abría archivos enteros, y lo que no encontraba lo contestaba de memoria. Además la documentación mezc… |

## instalacion

**Instalar y portar el arnés en otro repo, stack o plataforma**

| Entrada | Tipo | Qué contiene |
|---|---|---|
| [Varios proyectos: monorepo, varios repos, o una plataforma entera](multi-proyecto.md) | documento | La pregunta llega siempre igual: "¿pongo un arnés para todo, o uno por proyecto?". La respuesta sale de otra pregunta, que es la única que importa: |
| [Windows, macOS y Linux: el mismo gate en las tres](multiplataforma.md) | documento | Un arnés que sólo corre en la máquina de quien lo escribió no es un arnés: es una preferencia. Y el modo en que esto falla es siempre el mismo — no falla. El freno no se rompe con un error rojo: simplemente no existe en… |
| [Perfiles de stack](perfiles.md) | documento | El arnés es agnóstico, pero agnóstico no es vacío: hay cosas de un stack que ninguna convención de equipo decide, y hacer que cada repo las descubra a mano es la forma más rápida de que el portado se abandone a mitad de… |
| [Portar el arnés a tu repo](portar.md) | documento | Una tarde de trabajo, en este orden. El orden importa: cada paso hace verificable al siguiente. |
| [Quick start — de cero a gate verde en 10 minutos](quickstart.md) | documento | Un ejemplo completo y chico: un to-do de consola de cuatro archivos, con el arnés instalado y tres frenos que muerden de verdad. Todo lo de acá se corrió tal como está escrito; las salidas son reales, no ilustrativas. |

## flujo

**El ciclo de trabajo: ramas, registro, SDD, CI/CD, despliegue y worktrees**

| Entrada | Tipo | Qué contiene |
|---|---|---|
| [CI/CD — el mismo gate, en tres lugares](cicd.md) | documento | El comando es uno solo porque vive en un solo lugar: .claude/harness.config.json → gate.command, y la lista de señales en gate.signals. scripts/gate.mjs las ejecuta en orden y no sabe de stacks. |
| [El ciclo de desarrollo, declarado](ciclo-desarrollo.md) | documento | El modelo de ramas es la convención menos escrita de un repo: se explica una vez cuando alguien entra, se ve a medias en git log, y nadie se entera cuando deja de cumplirse. Con un agente en el equipo es peor: commitea… |
| [Despliegue seguro — un camino, a cualquier nube](despliegue.md) | documento | El pedido tenía dos caras, y las dos terminaban en que nadie desplegaba bien: |
| [SDD — cuándo el trabajo arranca con spec](sdd.md) | documento | Spec-Driven Development no es el modo por defecto de un repo: es la ruta para el trabajo que crea superficie nueva (una pantalla, un endpoint, un formato de intercambio, un módulo). Para un cambio acotado y reversible,… |
| [Trazabilidad — que el trabajo quede registrado](trazabilidad.md) | documento | Un cambio de producción que nadie registró existe sólo en la cabeza de quien lo hizo y en el diff. No se puede priorizar, no se puede asignar, no aparece en ningún avance, y cuando alguien pregunta "¿por qué cambió esto… |
| [Worktrees: un agente, una carpeta, una rama](worktrees.md) | documento | Cuando dos agentes (o un agente y vos) trabajan a la vez en el mismo repo, el choque no es de ideas: es de archivos. Los dos editan el mismo árbol de trabajo, uno cambia de rama bajo los pies del otro, y el gate de uno… |

## referencia

**El arnés por dentro: claves del config, señales, índices, panel, evaluaciones y recetas**

| Entrada | Tipo | Qué contiene |
|---|---|---|
| [Documentación](README.md) | documento | Cuatro capas, de la teoría al copiar y pegar. Si tenés diez minutos, leé metodo.md y el caso de estudio. |
| [El arnés de este repo — cómo está montado](arnes.md) | documento | Este repo se audita a sí mismo: es el ejemplo trabajando. La regla que manda es la misma que propone a los demás: una regla sin un comando que la haga fallar es una sugerencia. Cada fila de este documento nombra el coma… |
| [La biblioteca: la documentación indexada y el bibliotecario](biblioteca.md) | documento | El agente lee la documentación como lee el código sin índice: abre diez archivos para encontrar una fila de una tabla, y lo que no encuentra lo contesta de memoria. La biblioteca es el índice de la documentación, y el s… |
| [El índice del código es obligatorio — codegraph](codegraph.md) | documento | La herramienta es codegraph: un grafo de conocimiento del repo (símbolos, llamadas, radio de impacto) en una base SQLite local, sin API keys y sin que el código salga de la máquina. El arnés no la conoce por dentro: la… |
| [Referencia de `.claude/harness.config.json`](config-reference.md) | documento | El único archivo específico del repo. Los hooks y los scripts son genéricos: leen de acá. Portar el arnés = reescribir este archivo. |
| [Evaluaciones del arnés: determinista y con IA](evaluaciones.md) | documento | Dos familias que no se mezclan, porque se prueban distinto: |
| [El panel del arnés](panel.md) | documento | Una página HTML autocontenida que contesta de un vistazo tres preguntas: ¿el arnés está vivo?, ¿qué dice la memoria del repo? y ¿qué pasó de verdad en esta máquina?. Sin dependencias, sin red (salvo las sondas a localho… |
| [Recetas](recetas.md) | documento | Situaciones concretas, con el comando al lado. Todo lo de acá asume el arnés ya instalado (docs/portar.md). |

## incidentes

**Incidentes reales del arnés en formato fijo: síntoma, causa, regla, mecanismo**

| Entrada | Tipo | Qué contiene |
|---|---|---|
| [Gotchas — lo que ya nos costó horas](gotchas.md) | documento | Formato fijo: síntoma observable → causa raíz → regla → mecanismo que la hace fallar. Se escribe en el momento en que se paga, no "cuando haya tiempo" (/lesson <incidente>). |

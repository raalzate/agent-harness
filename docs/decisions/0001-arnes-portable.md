# ADR 0001 — El arnés vive en su propio repo, con la especificidad en un JSON

- **Fecha:** 2026-08-21
- **Estado:** aceptado
- **Contexto previo:** [`../buenas-practicas.md`](../buenas-practicas.md) (la guía agnóstica) y el
  arnés del proyecto donde nació, un escritorio Electron + Next con IA local.

## Contexto

El arnés se construyó dentro de un producto concreto y ahí funciona: hooks del ciclo del agente,
un gate único que corren el humano, el agente y CI, self-test de los frenos, constitución
versionada y un ciclo de incidentes que deja mecanismo. Lo que no existía era una forma de que
**otro equipo lo tuviera sin leer ese producto**.

Dos hechos hicieron obvio que el arnés era portable:

1. Los hooks ya eran genéricos. Toda la especificidad del producto —rutas protegidas, comandos
   denegados, catálogo de reuso, allowlists de deuda— vivía en un único `harness.config.json`.
2. Las reglas del lint, en cambio, **no** lo eran: `NOTACION`, `WEBGPU`, `IATASK`, `TOKENS` estaban
   escritas contra el dominio de ese producto. Eran siete reglas distintas que, mirándolas de
   costado, son cuatro **clases** de regla: "esta capa no importa X", "este literal sale de un solo
   registro", "este archivo conserva estas líneas", "este texto no va en este ámbito".

## Decisión

1. **Repo propio**, cuyo producto es el arnés y que se audita a sí mismo: su gate son el self-test,
   el link-check y el lint de sus propias convenciones. Un repo de buenas prácticas que no las
   cumple no convence a nadie.
2. **El gate es declarativo.** `scripts/gate.sh` no sabe de stacks: ejecuta `gate.signals` del
   config. Portar el gate a Go, Python o Terraform es editar JSON.
3. **Las reglas del lint se generalizaron a clases** (`purity`, `singleSource`, `invariants`,
   `patterns`, `forbiddenDeps`, `tests`, `incidents`), todas configurables. Las siete reglas del
   proyecto origen se expresan con esas clases sin perder nada.
4. **El self-test genera sus casos desde el config.** Antes cada freno tenía su caso escrito a
   mano; ahora, por cada regla, el self-test reduce el patrón a una muestra concreta y verifica que
   el freno la bloquee. Una regla nueva queda cubierta sin escribir código: eso es lo que hace que
   el arnés crezca sin que nadie recuerde mantener el self-test.
5. **Cada señal declara `why`.** Un campo obligatorio que dice qué error atrapa esa señal y ninguna
   otra. Es lo único que va a defender a la señal el día que el gate tarde y alguien la quiera sacar.
6. **Se separa lo que viaja de lo que no.** Viajan los principios, el método de portado y las clases
   de regla. No viajan las reglas concretas: describen los incidentes de un repo y en otro son ruido.

## Alternativas consideradas

- **Un paquete instalable (`npm i -D agent-harness`).** Descartado por ahora: el arnés tiene que ser
  legible y editable en el repo donde corre — su valor está en que el equipo lo entienda y lo
  cambie, no en que sea una caja negra actualizable. Un paquete además impone un ecosistema
  (Node) sobre repos que no lo tienen; hoy sólo hacen falta `node` y `bash`.
- **Config compartida a nivel organización.** Descartado: termina en reglas que no corresponden a la
  mitad de los repos, y en equipos entrenados para ignorar los frenos. Lo que se comparte son los
  principios y el método.
- **Dejar el lint como ESLint/ruff/golangci-lint con reglas propias.** Complementario, no sustituto:
  esas herramientas cubren estilo y bugs del lenguaje; las reglas de este lint son de arquitectura
  y dominio (qué capa importa qué, qué registro es fuente única, qué invariante no se pierde), y
  además tienen que correr en cualquier stack sin instalar nada.
- **Publicar sólo la guía en markdown.** Es lo que había. Una guía sin mecanismos es exactamente el
  anti-patrón que la guía denuncia.

## Consecuencias

- Portar el arnés es **una tarde**, y el trabajo real es contestar preguntas sobre el repo destino
  (¿cuáles son tus señales? ¿qué capa tiene que quedar limpia? ¿qué comando no tiene ctrl-Z?), que
  es exactamente donde está el valor.
- El self-test se volvió más fuerte y más barato al mismo tiempo: cubre reglas que todavía no
  existen.
- Aparece un límite nuevo: `sampleFromPattern` no puede reducir todos los regex a un ejemplo. Los
  casos que no puede se reportan **omitidos**, nunca pasados — un hueco declarado, no un falso verde.
- El lint sigue siendo regex sobre texto, sin AST. Alcanza para lo que cubre y no tiene
  dependencias; cuando eso no alcance, la señal correcta es el linter del stack, no complicar este
  script.
- Queda una deuda explícita: el ruteo de trabajo informa y no bloquea, porque la intención no es
  verificable por máquina. Lo cuida el `reviewer`.

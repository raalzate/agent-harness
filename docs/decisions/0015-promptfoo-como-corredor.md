# ADR 0015 — promptfoo evalúa a los subagentes como corredor, no como dependencia

- **Fecha:** 2026-10-19
- **Estado:** aceptado
- **Relacionado:** [0002](0002-sin-dependencias.md) (sin dependencias), [0007](0007-controles-fuera-del-gate.md) (controles fuera del gate), #63

## Contexto

La prueba de vida del `reviewer` (`scripts/reviewer-eval.mjs`) corre cada caso **una vez** y sólo
lee el veredicto. Una corrida con promptfoo y `--repeat 3` destapó lo que eso esconde: el caso
inocente «una regla nueva con su motivo» agregaba a `bash.deny` una regla que el config ya tenía en
`bash.ask`. El reviewer lo rechazó 3/3, y tenía razón. Con una sola corrida la tasa quedaba en 5/6
(83 %), sobre el umbral del 80 %: la etiqueta podrida pasaba en verde.

Faltaban además dos cosas que un regex sobre el veredicto no puede dar: la **calidad** del hallazgo
(¿cita `archivo:línea`?, ¿propone un mecanismo?) y la prueba de vida de los otros sensores
inferenciales (`gate-runner`, `ci-investigator`, `explorer`), que no tenían ninguna.

promptfoo resuelve las tres cosas: repeticiones, rúbricas con un modelo como juez y un visor. Pero
es un paquete npm, y el arnés no tiene dependencias (ADR 0002).

## Decisión

promptfoo entra como **corredor externo**, igual que la CLI `claude` en `reviewerEval`: se invoca
con `npx -y promptfoo@<versión fija>` (`aiEval.runner`) y nunca aparece en `package.json`.

- **El config sigue siendo la única fuente.** `scripts/ai-eval.mjs` genera el config de promptfoo
  en un temporal desde `aiEval`. Los casos del reviewer salen de `reviewerEval` (`casesFrom`), y el
  veredicto de cada agente sale de `subagentOutput.contracts`, la misma definición que lee el hook.
- **El veredicto es nuestro.** promptfoo corre y puntúa la rúbrica; la tasa por suite, el k/n por
  caso y el exit los calcula el script. El exit 100 de promptfoo no decide nada.
- **Aislamiento por construcción.** El proveedor (`scripts/eval/ai-provider.mjs`) corre cada agente
  en un temporal con copia sólo de su `context`, sin Bash y sin hooks: el mismo aislamiento que el
  gotcha del revisor que corrió el gate obligó a poner en `reviewer-eval`.
- **Nada sale de la máquina:** `--no-share` y la telemetría apagada (`aiEval.env`).
- **Convive** con `reviewer-eval.mjs`, que sigue siendo el camino sin dependencias y el que corre el
  barrido programado.
- **Sólo local por ahora.** Corre con la sesión de Claude Code de quien lo lanza. No tiene pipeline,
  y está dicho en el `$comment` de la clave: es una herramienta a mano para cuando cambia el prompt
  de un agente, no un control programado.

## Alternativas consideradas

- **El proveedor nativo `anthropic:claude-agent-sdk` de promptfoo.** Da trayectoria (qué
  herramientas usó el agente) sin trabajo extra. Descartada por ahora: exige instalar
  `@anthropic-ai/claude-agent-sdk` en el proyecto, que es una dependencia. Con la CLI, el `--agent`
  que se evalúa es exactamente el que corre en una sesión.
- **Agregarle `--repeat` y rúbricas a `reviewer-eval.mjs`.** Sin dependencias, pero reescribe un
  juez con un modelo, un visor y la concurrencia: el mantenimiento que el ADR 0002 evita.
- **Meterlo en el gate.** Descartada por el ADR 0007: caro y no determinista.
- **Un job en `drift.yml`.** Diferida: necesita un secreto en CI y gasta cuota en cada barrido. Al
  activarla, el `runner` pasa a ser ese pipeline y el self-test lo verifica, como con `reviewerEval`.

## Consecuencias

- Un 0/n por caso dice «revisá la etiqueta», y un k/n inestable dice «revisá el prompt del agente».
  Una tasa sola no distingue las dos cosas.
- promptfoo pide node ≥ 22.22 (`minNode`). En un node más viejo, el eval sale OMITIDA con el motivo.
- Una versión nueva de promptfoo no entra sola: se cambia la versión fija, eligiendo una que tenga
  al menos dos semanas, y se vuelve a correr.
- El self-test (10f) prueba la máquina con un promptfoo de mentira que carga el proveedor real: la
  tasa, el k/n, el aislamiento, lo roto y lo omitido. Que los agentes acierten sólo lo dice una
  corrida real.

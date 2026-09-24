# ADR 0009 — El gate regenera el panel del arnés en cada corrida, sin que el panel decida nada

- **Fecha:** 2026-09-24
- **Estado:** aceptado
- **Relacionado:** [0004](0004-contrato-de-hooks.md), [0007](0007-controles-fuera-del-gate.md), [panel.md](../panel.md)

## Contexto

Para saber si el arnés estaba vivo había que correr cinco comandos (`map`, `lint:rules`, `timing`,
el self-test, leer STATUS) y juntar las salidas a mano. STATUS.md es prosa con fecha: dice
«verde» aunque lo último que corrió en esta máquina haya salido rojo. Un panel que hay que
acordarse de regenerar tiene el mismo defecto: se mira una foto vieja creyendo que es de hoy.

## Decisión

1. **El panel se deriva, no se escribe.** `scripts/panel/` lee el config, los settings, STATUS,
   los incidentes y la constitución —el formato que los frenos ya exigen— y el registro que el gate
   escribe. Sin IA y sin red. La memoria es determinista byte a byte.
2. **El gate lo regenera al final de CADA corrida**, verde o roja, y antes escribe
   `gate.registry` (`.git/harness-gate.json`): por señal, su último resultado y su último verde.
   El gate es el momento en que la salud cambia; atarlo ahí es lo que hace que el panel nunca sea
   más viejo que el último gate.
3. **El panel no decide el veredicto.** Corre como proceso hijo, con tiempo límite
   (`panel.timeoutMs`), y su exit code se ignora. La primera versión lo importaba en el proceso del
   gate y el reviewer demostró el agujero: un `process.exit(0)` en el panel volvía verde a un gate
   rojo y borraba el marcador; un panel colgado colgaba al gate. Es el contrato de 0004 llevado al
   gate: lo roto deja pasar, nunca decide.
4. **Las alarmas no inventan criterios.** Cada una es la versión visible de algo que un comando ya
   pone en rojo, y lo nombra. Una fuente que falta no es alarma (ningún freno la frena): se dice
   en «Fuentes».
5. **Todo lo específico va al config** (`panel`), con defaults deducidos de claves que ya existen.
   El gestor de trabajo se lee por un comando que declara el repo: ningún script conoce una forja.
6. **Se escribe en `.git/`**, no en el árbol (P7), resolviendo el `gitdir` en un worktree.

`resolverEjecutable` pasó a `.claude/hooks/harness.mjs`: el gate y el panel lanzan comandos del
config, y la alternativa a compartirlo era `shell: true`.

## Consecuencias

- El gate tarda lo que tarda el panel (~0,5 s acá; hasta `panel.tracker.timeoutMs` más si hay
  gestor declarado).
- `scripts/gate.mjs` ahora importa `.claude/hooks/harness.mjs`. Si esa plomería se rompe, el gate
  muere al arrancar —en rojo, que es lo correcto para un gate que no puede resolver sus comandos.
- Lo que prueba que el panel genera y que sus alarmas muerden es el self-test (sección 11), no el
  gate: el gate sólo lo corre.
- El registro y los tokens son de ESTA máquina. El artefacto de CI es el de esa corrida.

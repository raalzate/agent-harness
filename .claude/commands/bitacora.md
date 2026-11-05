---
description: Depura la bitácora de STATUS.md y los gotchas — valida, detecta lo obsoleto y reconstruye.
argument-hint: "[check | log <filtro> | rebuild]"
allowed-tools: Bash, Read, Grep
---

`STATUS.md` es una **bitácora** (event sourcing) y es el único archivo de estado. Cada cambio es
una fila con `#`, timestamp, autor, evento, clave, qué pasó y evidencia. Arriba hay una
**proyección** que `node scripts/status.mjs rebuild` reproduce desde la bitácora: un índice con el
veredicto, el `#` y la fecha de cada señal y el título de cada deuda. El texto completo vive sólo
en la fila de su evento (`log --key "<clave>"`), y el de un gotcha sólo en el registro de
incidentes. La proyección no se edita a mano: se registra un evento. Se enciende con la clave
`status.events` del config; sin ella el script dice que la bitácora está apagada.

Pedido: `$ARGUMENTS` (vacío = depuración completa).

1. **Ingerir lo pendiente.** `node scripts/status.mjs sync`: los veredictos que el gate dejó en el
   journal (`.git/`) pasan a la bitácora. Si contesta que el archivo no es bitácora, sigue en
   prosa: mostrale al humano `migrate` (dry-run) y esperá su confirmación antes de `--apply`.
2. **Diagnóstico.** `node scripts/status.mjs check`. Leé cada línea:
   - `✗` es rojo del gate. Se arregla **con un evento**, no editando la tabla:
     - gotcha sin evento → `record incident.recorded "<título exacto>" --evidence "docs/gotchas.md"`;
     - evento sin gotcha (renombrado o borrado) → `record incident.retired "<clave>" "<por qué>"`, y
       si fue un renombre, también el `incident.recorded` con el título nuevo;
     - proyección editada a mano → registrá el cambio como evento y corré `rebuild`;
     - `#` duplicado (merge de dos ramas) → `rebuild --reseq`.
   - `⚠` es obsoleto o viejo: **verificá antes de registrar**.
     - Una señal vieja se re-verifica corriendo SU comando (`log --key "<señal>"` muestra la
       evidencia). Después se registra `signal.verified` con el resultado real de hoy, o
       `signal.retired` si la señal ya no existe.
     - Una deuda vieja se cierra (`debt.closed`, con la evidencia que la cierra) sólo si un comando
       lo demuestra.
     - Si dos gotchas tienen la misma regla, proponé fusionarlos al humano; no los fusiones solo.
3. **Historia.** Para responder «qué pasó con X / quién lo verificó / cuándo se puso rojo»:
   `node scripts/status.mjs log [--event <tipo>] [--key <texto>] [--author <quién>] [--since AAAA-MM-DD]`.
   Con un solo resultado muestra la fila completa.
4. Cerrá con `node scripts/status.mjs check` verde y un resumen: qué eventos registraste (con su
   `#`), qué quedó como aviso y por qué.

Reglas:

- **El autor es quien verificó.** Si registrás vos, usá `--author` con tu rol (p. ej.
  `claude (agente)`), salvo que el humano te pida firmar con su nombre. Por defecto sale
  `git config user.name`.
- **Nada se registra sin evidencia** que alguien pueda volver a correr. Registrar
  `signal.verified` sin haber corrido el comando es inventar historia.
- **Nunca se borran filas de la bitácora.** Si algo estaba mal, va un evento nuevo que lo corrige.

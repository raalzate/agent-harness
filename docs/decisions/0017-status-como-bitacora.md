# ADR 0017 — STATUS.md es una bitácora y el estado es su proyección

- **Fecha:** 2026-11-05
- **Estado:** aceptado
- **Relacionado:** [0004](0004-contrato-de-hooks.md) (fallar abierto), [0009](0009-panel-del-arnes.md) (lo que escribe el gate no cambia el veredicto)

## Contexto

`STATUS.md` es lo que el hook `SessionStart` le presenta al agente como verdad. Se editaba en el
lugar: una fila de señal se reescribía sin dejar rastro de lo que decía antes, sin autor y con una
sola fecha para todo el archivo. Cuando el veredicto cambiaba, nadie sabía quién lo había medido ni
qué decía la versión anterior. Los gotchas tenían el mismo problema: nada los relacionaba con el
estado, y uno renombrado o borrado no dejaba ninguna huella.

## Decisión

- **Event sourcing.** El archivo tiene dos partes. Abajo, una **bitácora append-only**: una tabla
  con `#`, timestamp ISO con offset, autor, evento, clave, qué pasó y evidencia. Arriba, una
  **proyección** (fecha, rama, veredicto, señales, deuda) que `rebuild` (de `scripts/status.mjs`) reproduce
  plegando la bitácora en orden. La proyección no se edita: un cambio es un evento.
- **Un solo archivo, ningún texto dos veces.** La proyección es un índice: la deuda por título y
  cada señal con la palabra del veredicto, el `#` del evento y su fecha. El texto completo vive sólo
  en la fila de su evento (`log --key`). Un `incident.recorded` lleva el título y el puntero
  `docs/gotchas.md:línea`, no una copia del síntoma. La primera versión copiaba los textos arriba y
  abajo, y movía los eventos viejos a un `STATUS-ARCHIVE.md`; el humano lo leyó como un STATUS
  duplicado y redundante, y lo era.
- **Vocabulario cerrado**: `gate.verdict`, `signal.verified`/`retired`, `debt.opened`/`closed`,
  `incident.recorded`/`retired` y `note`. Cerrar algo que no está abierto se rechaza.
- **El gate no escribe `STATUS.md`.** Cuando el veredicto cambia, o cuando el último registrado
  tiene más de `heartbeatDays`, anota un `gate.verdict` en un journal bajo `.git/` (P7). Lo pasan a
  la bitácora `sync` o `record`. Si el gate escribiera un archivo versionado, el árbol quedaría
  sucio en cada veredicto y la señal `task` saldría roja en la corrida siguiente.
- **Los gotchas conservan su formato** (lo exige la regla `INCIDENTE`) y cada uno tiene un
  `incident.recorded` cuya clave es su título. Un gotcha sin evento, o un evento sin gotcha, es rojo.
- **Señal del gate «status ledger»** (`status.mjs check`). Sale rojo cuando:
  - la tabla está mal formada;
  - falta o se repite un `#`;
  - la proyección no coincide con el replay;
  - hay un evento desconocido;
  - algo se cierra sin haberse abierto;
  - los gotchas no coinciden con sus eventos.

  Lo obsoleto o viejo (evidencia que apunta a una ruta que git no tiene, señales sin re-verificar,
  deuda abierta hace mucho) sale como **aviso**: decide un humano, no la máquina (P3).
- **Sólo `migrate` convierte prosa.** Los demás comandos que escriben se niegan a tocar un
  `STATUS.md` que no tiene los marcadores. Lo encontró el `reviewer`: `sync` sobre un archivo en
  prosa reescribía todo lo que estaba debajo del primer `##`.

## Consecuencias

- **Acoplamiento nuevo:** `scripts/status.mjs` → `scripts/panel/leer-fuentes.mjs`. Es a propósito,
  para que haya una sola verdad sobre cómo se lee el markdown y sobre los títulos y campos que lee el
  panel (`panel.status`). `check` sale rojo si una etiqueta deja de casar con el patrón del panel.
- **Lo que se espera que cambie:** cada cambio de veredicto en una rama de feature termina como una
  fila permanente, incluido el rojo de mitad de desarrollo. Es auditoría, no ruido. El archivo crece
  una fila corta por evento; la proyección queda arriba y el hook de sesión sólo lee esa parte.
- **Merge de dos ramas:** las dos agregan filas con el mismo `#`. `check` lo detecta y
  `rebuild --reseq` renumera en el orden del archivo, no por fecha, para que un cierre no quede
  antes de su apertura.
- **Repos portados:** reciben el script y `/bitacora` apagados. Siguen en prosa hasta que declaren
  `status.events` y corran `migrate --apply`.

## Alternativas descartadas

- **Bitácora en un archivo aparte:** habría dos fuentes que pueden divergir.
- **Archivar los eventos viejos en otro archivo (`compact`):** existió en la primera versión. Un
  segundo archivo con forma de STATUS se lee como un duplicado, y el replay pasaba a depender de
  dos archivos. Se sacó: es preferible un archivo que crece a dos que se parecen.
- **Que el gate escriba `STATUS.md` en cada corrida:** viola P7 y deja rojo el alcance de la tarea.
- **Pasar los gotchas a una tabla:** las celdas serían enormes y habría que reescribir la regla
  `INCIDENTE` sin ganar nada. El evento ya los pone en la línea de tiempo.

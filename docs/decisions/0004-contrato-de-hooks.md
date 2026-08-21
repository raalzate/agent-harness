# ADR 0004 — El contrato de los hooks, y por qué un arnés roto deja pasar

- **Fecha:** 2026-08-21
- **Estado:** aceptado
- **Relacionado:** [0001](0001-arnes-portable.md), [0003](0003-selftest-generado.md)

## Contexto

Los hooks son el único componente del arnés que corre **dentro** del ciclo del agente, y su
interfaz es angosta a propósito: entra JSON por stdin, y lo único que sale es un código de salida
más un texto. Sobre eso hay que decidir dos cosas que no son obvias.

**Primera: qué código de salida significa qué.** El anfitrión define que `0` deja pasar y `2`
bloquea, y que en el caso de bloqueo lo que el agente lee es **stderr**. Un `exit 1` no bloquea:
señala que el hook falló y se ignora. Eso vuelve al `exit 1` la peor salida posible — parece un
error, no frena nada, y nadie se entera. Hay un detalle más, fácil de perder: para
`UserPromptSubmit` y `SessionStart`, el **stdout se inyecta en el contexto del agente**. Es decir:
en un hook, `console.log` no es depuración, es hablarle al agente.

**Segunda, y es la decisión de fondo: qué hace un hook cuando el arnés está roto.** Si falta el
config, si tiene un JSON inválido, si un regex no compila — ¿el hook bloquea (falla cerrado) o deja
pasar (falla abierto)?

## Decisión

**El contrato se respeta y se hace verificable.** Toda la plomería vive en un único módulo
(`.claude/hooks/harness.mjs`) que expone `deny(mensaje)` → stderr + `exit 2` y `allow(mensaje?)` →
stdout opcional + `exit 0`. Ningún hook llama a `process.exit` por su cuenta, y el config declara un
`invariants` sobre ese archivo: tiene que contener `process.exit(2)` y `process.exit(0)`, y no puede
contener `process.exit(1)`. Además, una regla `patterns` prohíbe `console.log` en los hooks: la
forma de hablarle al agente es `allow`/`deny`, para que quede explícito que ese texto va al contexto.

**Un arnés roto falla abierto.** Config ausente, JSON inválido, stdin ilegible, regex que no
compila: el hook **deja pasar** en silencio. Tres razones:

1. **El arnés no es el producto.** Su trabajo es hacer cumplir reglas del repo, no ser un punto
   único de falla que impida trabajar. Un `harness.config.json` con una coma de más no puede
   bloquear a todo el equipo.
2. **El modo cerrado se sabotea.** Un freno que bloquea todo cuando está roto se desactiva a mano
   la primera vez que pasa, y con él se van los frenos que sí servían. Es el mismo mecanismo del
   freno que muerde de más (P3 de la constitución).
3. **El hueco está tapado en otro lado, y ahí sí es cerrado.** Que el config esté sano no es un
   problema del turno del agente: es una señal del gate. El self-test valida cada ruta y cada regex
   ([0003](0003-selftest-generado.md)), y el gate es rojo si algo no resuelve. La verificación
   ocurre donde el costo del falso positivo es bajo, no en el camino crítico.

## Alternativas consideradas

- **Fallar cerrado** (bloquear si el arnés está roto). Es la elección correcta en seguridad, y si
  estos hooks fueran un control de seguridad —no lo son: son guardarraíles, ver `README.md`— sería
  la respuesta. Descartada por las tres razones de arriba, y con una condición explícita de
  revisión: **si alguna vez un hook cuida algo cuyo bypass sea inaceptable** (un secreto, un deploy),
  ese hook falla cerrado y se documenta como excepción. Hoy ninguno está en esa categoría.
- **Cada hook con su propio manejo de errores y sus `process.exit`.** Es lo que sale naturalmente al
  escribirlos uno por uno. Descartada: nueve hooks con nueve criterios distintos garantizan que
  alguno use `exit 1` y frene nada. El módulo compartido lo vuelve una decisión sola y verificable.
- **Loguear el error del arnés a stderr aunque deje pasar.** Tentador: "que al menos se vea". Pero en
  un hook que no bloquea, stderr es ruido que nadie lee, y en `UserPromptSubmit` el stdout entra al
  contexto — avisar por ahí gasta contexto en cada prompt para un problema que el gate ya reporta.
  Descartada: el aviso vive en `SessionStart` (una vez por sesión) y en el gate.

## Consecuencias

- Un hook nuevo no decide nada del protocolo: importa `deny`/`allow` y listo. Y si alguien intenta
  otra cosa, el lint lo marca.
- El invariante convierte en gate rojo una regresión que de otro modo sería invisible: un `exit 1`
  colado en la plomería desactivaría **todos** los frenos a la vez sin cambiar ningún comportamiento
  visible.
- Se acepta un agujero conocido: con el config roto, durante ese rato, no hay frenos de hook. El
  mitigante es que el gate no puede quedar verde en ese estado, y que `SessionStart` avisa.
- `console.log` prohibido en hooks tiene un costo real de ergonomía: depurar un hook implica stderr
  o correrlo a mano con un payload (que es, justamente, lo que hace el self-test). Se acepta porque
  la confusión inversa —creer que se está depurando cuando en realidad se le está hablando al
  agente— es peor.

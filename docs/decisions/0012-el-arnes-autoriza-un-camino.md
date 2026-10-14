# ADR 0012 — El arnés autoriza UN camino de despliegue, y sólo esa forma exacta

- **Fecha:** 2026-10-13
- **Estado:** aceptado
- **Relacionado:** [0004](0004-contrato-de-hooks.md), [despliegue.md](../despliegue.md), issue #47

## Contexto

Hasta acá los hooks del arnés sólo hacían tres cosas: dejar pasar callados, bloquear (exit 2) o
pedirle el sí al humano (`ask`). Ninguno **otorgaba** un permiso. Desplegar mostró por qué hacía
falta: Claude Code frena en bloque todo lo que huele a infraestructura, y la única salida
disponible era abrir `permissions.allow` con `Bash(kubectl:*)` o `Bash(aws:*)`. Eso autoriza
también el `delete` y saca al humano justo de la decisión que importa. La otra salida era
contestar «sí» a cada pregunta, que con el tiempo es lo mismo pero peor: nadie lee.

## Decisión

1. **Un punto de entrada** (`scripts/deploy.mjs`) y un hook (`deploy-guard`) que lo autoriza con
   `permissionDecision: "allow"` **sólo** en su forma exacta: una de las cadenas de `deploy.entry`,
   un destino (`[A-Za-z0-9._-]+`) y, como mucho, `--apply`. Sólo ASCII imprimible, separado por
   espacios o tabs. Cualquier otra cosa vuelve al permiso normal.
2. **Qué se autoriza:** el dry-run siempre, y el `--apply` sólo a un destino `approval: "agent"`.
   Un destino `human` o no declarado le pregunta al humano.
3. **La autorización la respalda el script, no el hook.** `--apply` verifica árbol limpio, rama,
   remoto al día, gate verde sobre el HEAD y variables de entorno. Además, siempre y sin forma de
   sacarlo: **el config commiteado y sin cambios**. El hook decide según el config del disco, y
   sin esa condición el agente podía ponerse a sí mismo `approval: "agent"` en el mismo turno.
4. **El script no acepta `--config`.** El config es el del repo donde vive el script; el
   self-test lo copia a un repo temporal.
5. **El hook no autoriza un comando que casa `bash.deny` o `bash.ask`.** Así la seguridad no
   depende de cómo resuelve Claude Code dos decisiones de hooks distintos sobre la misma llamada.
6. Lo que no es el camino se pregunta (desplegar crudo, leer secretos) o se bloquea (destruir un
   entorno), y lo que es lectura pasa sin opinión: `passExamples` lo prueba.

## Por qué así

La primera versión aceptaba `\s` y cualquier bandera. El `reviewer` encontró dos agujeros con PoC:
`… deploy.mjs\nprintenv` (para bash, el salto de línea es otro comando) y `--config <archivo del
agente>`, que hacía correr un comando arbitrario por el camino autorizado. Las dos cosas tienen la
misma raíz: autorizar un **patrón** en vez de una **forma**. Cada vector quedó como caso del
self-test (3c-ter).

## Consecuencias

- Un destino `agent` despliega sin interrumpir al humano. Pasar a `agent` es un cambio de config
  que entra por PR, que es donde el equipo decide quién despliega qué.
- En Windows los comandos corren por `cmd.exe`, así que un argumento con metacaracteres de cmd se
  rechaza en vez de interpretarse.
- Lo que sigue siendo juicio: que el `planCommand` sea de verdad de sólo lectura, y que un token no
  termine escrito dentro de `command`. El script lo imprime y llegaría al transcript.

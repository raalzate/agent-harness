# ADR 0005 — El índice del código es obligatorio, y viaja como señal del gate

- **Fecha:** 2026-09-15
- **Estado:** aceptado
- **Relacionado:** [0001](0001-arnes-portable.md), [0004](0004-contrato-de-hooks.md)

## Contexto

El arnés traía el hook `graph-first.mjs` desde el principio y la guía de fondo recomendaba
"consultar el índice antes de abrir archivos". Dos hechos incómodos:

1. **El hook estaba instalado y muerto.** Se activa con la clave `graph` del config, y este repo
   nunca la tuvo: `STATUS.md` lo declaraba como deuda. Es exactamente el anti-patrón que el arnés
   existe para evitar, cometido en el propio arnés — y lo destapó el mismo mecanismo que lo caza
   en otros (`install.activators`).
2. **"Recomendado" no cambia el comportamiento.** Leer archivos a mano es el camino por default del
   agente y no falla nunca de forma visible: falla gastando contexto, perdiéndose las relaciones
   que el texto no muestra (despacho dinámico, implementaciones de una interfaz) y estimando el
   radio de impacto de memoria. Ninguna de las tres cosas deja rastro en un log.

La tercera es la que decide: sin grafo, **el acoplamiento se opina**. Y las reglas de diseño del
arnés (`purity`, `reuse`, `forbiddenDeps`) verifican fronteras que alguien tuvo que ver primero.

## Decisión

**El índice pasa de recomendación a requisito, con tres mecanismos de fuerza distinta.**

- La herramienta por default es [codegraph](https://github.com/colbymchenry/codegraph): grafo local
  en SQLite, sin dependencias de servicio, auto-sincronizado al guardar, agnóstico de lenguaje. Se
  declara en `graph` — el hook no la conoce: lee `graphFile`, `queryCommand` y `questionPatterns`.
- **Señal del gate** `índice del código (codegraph)` → `codegraph status`, con
  `skipIfMissing: ".codegraph"`. Sin índice no falla: se reporta **OMITIDA**, y una señal omitida
  no es verde. La omisión impresa en cada corrida es el recordatorio.
- **`protectedPaths`** cubre `^\.codegraph/`: el índice es derivado, se reconstruye, no se edita.

El `skipIfMissing` es deliberado. Un gate que se pone rojo porque falta una herramienta **local**
castiga a quien clona el repo por primera vez y a CI, y el castigo se paga sacando la señal.
Omitido-no-es-verde consigue lo mismo sin dar motivos para desactivarla.

## Alternativas consideradas

- **Dejarlo como prosa en la guía.** Es lo que había. No cambió el comportamiento en ninguna
  sesión medible: por eso este ADR.
- **Señal del gate sin `skipIfMissing` (rojo si falta).** El gate pasaría a depender de un binario
  externo instalado a mano; el arnés corre con `node` y `bash` a propósito (ADR 0002). Primer clon
  en rojo es la forma más rápida de que alguien borre la señal.
- **Bloquear `Read`/`Grep` con un hook hasta que se consulte el índice.** Es el mecanismo más
  fuerte y se descartó hoy: no hay forma barata de saber si la consulta ya ocurrió, y un freno que
  muerde de más se desactiva a mano en una semana (P3). Queda anotado como el paso siguiente si la
  omisión resulta insuficiente.
- **Atarlo a una herramienta distinta (LSP, ctags).** Resuelven símbolos, no rutas de llamada ni
  radio de impacto, que es lo que falta al decidir diseño.

## Consecuencias

- Se vuelve más fácil contestar "¿qué se rompe si toco esto?" con una llamada en vez de veinte
  lecturas, y las decisiones de [arquitectura.md](../arquitectura.md) pasan a medirse.
- Se acepta un costo recurrente: una herramienta externa más por máquina, y un
  `codegraph init` por repo. La instalación está en [codegraph.md](../codegraph.md).
- Queda deuda declarada: **nadie verifica que el agente consulte el índice antes de leer**. Es
  juicio del `reviewer`, y está anotado en `STATUS.md`.

# ADR 0001 — La especificidad del repo va en un JSON, y el gate es declarativo

- **Fecha:** 2026-08-21
- **Estado:** aceptado
- **Contexto previo:** [`../buenas-practicas.md`](../buenas-practicas.md) (la guía de fondo,
  agnóstica de stack)

## Contexto

Un arnés de agente que funciona termina, casi siempre, atado al repo donde se construyó: el gate
enumera los comandos de ese stack en un script de shell, y las reglas del lint nombran los módulos,
los tipos y los flags de ese producto. El resultado es correcto ahí y **intransferible** a
cualquier otro lado.

Mirando esas reglas de costado, la mayoría no son reglas distintas: son la misma **clase** de regla
con otro contenido. "Esta capa no importa el framework", "este literal sale de un solo registro",
"este archivo de arranque conserva estas líneas", "este texto no va en este ámbito". Cuatro clases
cubren casi todo lo que un repo necesita verificar y que ningún linter estándar conoce.

Lo otro que suele quedar atado es el gate. Un `gate.sh` con las señales escritas a mano en bash es
un archivo que hay que reescribir en cada repo, y el que lo reescribe suele copiar las señales de
otro proyecto sin preguntarse qué atrapa cada una.

## Decisión

1. **Toda la especificidad vive en `.claude/harness.config.json`.** Hooks y scripts son genéricos:
   leen ese archivo. Cambiar una regla es editar JSON; portar el arnés es reescribir un archivo.
2. **El gate es declarativo.** `scripts/gate.sh` no sabe de stacks: ejecuta `gate.signals` del
   config, en orden, con el argv de cada señal (sin shell y sin `eval` sobre datos del config).
   Portarlo a Go, Python o Terraform es editar JSON.
3. **Cada señal declara `why`:** qué clase de error atrapa que ninguna otra atrapa. Es un campo
   obligatorio —el self-test rechaza una señal sin él— porque es lo único que va a defender a la
   señal el día que el gate tarde y alguien la quiera sacar. Y si el `why` deja de ser cierto, la
   señal se saca sin culpa.
4. **Las reglas del lint son clases configurables**, no reglas cableadas: `purity`, `singleSource`,
   `invariants`, `patterns`, `forbiddenDeps`, `tests`, `incidents`. Agregar una regla al proyecto es
   editar JSON; agregar una *clase* nueva es tocar el script, y entonces lleva su caso de self-test
   escrito a mano.

Tres decisiones que se tomaron junto con estas tienen su propio ADR, porque tienen alternativas
propias y se pueden revisar por separado: [0002](0002-sin-dependencias.md) (sin dependencias),
[0003](0003-selftest-generado.md) (el self-test se genera desde el config) y
[0004](0004-contrato-de-hooks.md) (el contrato de los hooks y qué pasa cuando el arnés está roto).

## Alternativas consideradas

- **Un `gate.sh` escrito a mano por repo.** Es lo habitual y es lo que vuelve el gate intransferible.
  Peor: invita a copiar señales de otro proyecto sin preguntarse qué atrapa cada una, que es
  exactamente lo que el campo `why` obliga a contestar.
- **Config compartida a nivel organización.** Descartado: termina en reglas que no corresponden a
  la mitad de los repos, y en equipos entrenados para ignorar los frenos. Lo que se comparte son
  los principios y el método de portado; las reglas concretas describen los incidentes de **un**
  repo.
- **Reglas propias dentro de ESLint / ruff / golangci-lint.** Complementario, no sustituto: esas
  herramientas cubren estilo y bugs del lenguaje. Estas reglas son de arquitectura y de dominio, y
  tienen que correr en cualquier stack sin instalar nada.
- **Dejar todo en markdown.** Es el punto de partida de casi todos los repos, y es exactamente el
  anti-patrón que la guía de fondo denuncia: una regla sin un comando que la haga fallar es una
  sugerencia.

## Consecuencias

- Portar el arnés es **una tarde**, y el trabajo real es contestar preguntas sobre el repo destino
  (¿cuáles son tus señales? ¿qué capa tiene que quedar limpia? ¿qué comando no tiene ctrl-Z?), que
  es donde está el valor.
- **El config se vuelve el archivo más importante del repo** y también el más fácil de romper: un
  regex mal escrito o una ruta que se movió desactivan un freno en silencio. Por eso el self-test
  valida el config entero (cada ruta resuelve, cada regex compila) antes de probar cualquier freno.
- **El lint es regex sobre texto, sin AST.** Alcanza para lo que cubre y no tiene dependencias; un
  patrón dentro de un comentario o de un string cuenta igual. Cuando eso no alcance, la señal
  correcta es el linter del stack, no complicar este script. No hubo alternativa evaluada de verdad:
  es una consecuencia de [0002](0002-sin-dependencias.md), y ahí está el análisis.
- Queda una deuda explícita: el ruteo de trabajo informa y no bloquea, porque la intención no es
  verificable por máquina. Lo cuida el subagente `reviewer`.

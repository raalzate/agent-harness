# ADR 0003 — El self-test genera sus casos desde el config

- **Fecha:** 2026-08-21
- **Estado:** aceptado
- **Relacionado:** [0001](0001-arnes-portable.md) (la especificidad va en un JSON)

## Contexto

Un arnés se degrada por una vía específica: alguien agrega una regla, la regla nunca se prueba, y
seis meses después ya no bloquea nada. El archivo está ahí, el config la declara, y en la práctica
es decorativa. Es el anti-patrón **"instalado y muerto"**, y no tiene síntoma: ninguna otra señal
del gate mira si los frenos frenan.

La respuesta obvia es un caso de prueba por freno, escrito a mano. Funciona el primer mes. Después
pasa lo que pasa siempre: la regla nueva entra al config en el commit apurado del viernes, el caso
de prueba queda para "cuando haya tiempo", y la cobertura del arnés empieza a divergir de las reglas
que el arnés dice tener. El self-test sale verde y verifica cada vez menos.

Hay un dato que cambia el problema: **las reglas ya están declaradas en un formato que una máquina
puede leer** (ADR [0001](0001-arnes-portable.md)). Si una regla es un regex más un ámbito, entonces
el caso de prueba de esa regla es derivable: hace falta un texto que el regex cace.

## Decisión

El self-test **no tiene casos por freno escritos a mano**. Recorre el config y, para cada regla,
deriva su propio caso:

1. `sampleFromPattern` reduce el regex a una **muestra concreta**: resuelve los escapes a literales,
   toma la primera rama de cada alternativa, descarta los grupos opcionales, rellena los comodines.
2. Con esa muestra ejecuta el freno de verdad —el hook real, con un payload real por stdin— y exige
   el bloqueo (exit 2 para los hooks, exit distinto de 0 para el lint).
3. Los frenos del lint reciben el contenido **por stdin** (`--file <ruta virtual> --stdin`), así el
   self-test nunca escribe archivos dentro del árbol de fuentes.
4. Además de "muerde", se prueba "**no muerde de más**" con casos fijos que tienen que pasar: un
   archivo normal, un `git status`, un pedido trivial que el router debe ignorar en silencio.
5. Lo que no se puede derivar se reporta **omitido**, con el motivo, y nunca cuenta como pasado.

Corolario operativo: **agregar una regla al config no requiere tocar el self-test.** Agregar una
*clase* de regla nueva o un hook nuevo sí, y eso queda escrito como principio (P2 de la
constitución): un freno sin prueba de vida es decorativo.

## Alternativas consideradas

- **Un caso escrito a mano por freno.** Es lo habitual y es más preciso: el autor de la regla sabe
  exactamente qué debería bloquear. Descartada como *mecanismo principal* porque su punto de falla
  es humano y silencioso — la regla que entra sin su caso no rompe nada hoy. Se mantiene para las
  clases de regla y los hooks, donde el comportamiento no es derivable.
- **Property-based testing** (generar entradas al azar y buscar contraejemplos). Más potente para
  encontrar agujeros en un patrón. Descartada: la pregunta que este freno tiene que contestar no es
  "¿el patrón tiene agujeros?" sino "¿el eslabón activador está conectado?" — y para eso una muestra
  determinista alcanza y es reproducible.
- **Analizar el regex con un parser de expresiones regulares** para generar una cadena que lo
  satisfaga formalmente. Es la solución correcta y existen librerías que lo hacen. Descartada por
  [0002](0002-sin-dependencias.md): implicaría una dependencia. La reducción heurística cubre los
  patrones que la gente escribe en la práctica, y **declara** los que no.
- **No probar los frenos y confiar en el review.** Es el estado del que se parte en casi todos los
  repos, y es exactamente lo que la guía de fondo denuncia.

## Consecuencias

- El self-test crece solo: cubre reglas que todavía no existen. Es la propiedad que hace que el
  arnés no se degrade con el uso.
- **Un regex mal escrito se detecta como tal**, no como una regla que "no encontró nada". Si el
  patrón no cazó su propia muestra, algo está roto: o el patrón o el hook.
- Aparece un límite nuevo y propio de esta decisión: `sampleFromPattern` no reduce lookbehind,
  backreferences ni clases anidadas. Esos casos salen **omitidos** y hay que probarlos a mano. Es un
  hueco declarado, no un falso verde — y es la primera deuda listada en `STATUS.md`.
- La muestra derivada puede ser rara a la vista (`sed -i x src`). No importa: no es un ejemplo
  didáctico, es una entrada que el patrón debe cazar. Cuando importe, el candidato ya está anotado:
  un campo `sample` opcional por regla para que el autor dé el ejemplo.
- Al portar el arnés, el self-test se vuelve **el mapa del trabajo pendiente**: con el config de
  arranque sale rojo y cada línea nombra la clave que todavía apunta a la nada. Eso está documentado
  para que ese rojo no se lea como "el arnés viene roto".

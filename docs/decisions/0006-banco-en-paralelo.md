# ADR 0006 — El banco corre en procesos hijos, y el contrato entre padre e hijo es la salida

- **Fecha:** 2026-09-22
- **Estado:** aceptado
- **Relacionado:** [0001](0001-arnes-portable.md), [0002](0002-sin-dependencias.md), [0003](0003-selftest-generado.md)

## Contexto

`npm run gate` tardaba **129s** con diez núcleos al 88% de **uno**. Medido señal por señal:
el banco 77.7s, el self-test 46.8s, el resto ~4s. Dentro del banco, un solo caso —el
`quickstart`— eran 50.2s: dos gates anidados y un self-test suelto que resultó ser, comando
por comando y config por config, la primera señal de esos mismos gates.

El trabajo no es pesado. Es **arranque de procesos en serie**: ~65ms de `node` por invocación,
cientos de invocaciones, una atrás de la otra. Un gate que tarda dos minutos se corre menos, y
un freno que se corre menos es un freno que no está.

Los nueve casos del banco ya eran independientes **por construcción**: cada uno instala el
arnés en su propio repo git temporal bajo `os.tmpdir()`, y P7 prohíbe que escriban en el árbol
de fuentes. No comparten nada. Correrlos en serie era una decisión que nadie había tomado.

## Decisión

**El banco corre un proceso hijo por caso, tantos a la vez como núcleos disponibles**
(`os.availableParallelism()`, que en un contenedor de CI devuelve la cuota y no el host).
`--paralelo=1` vuelve a la serie, que es el modo para depurar porque la salida sale en vivo.

Tres cosas que no son detalle de implementación:

1. **El padre no prueba: junta.** Toda la lógica de un caso sigue en el mismo lugar y corre
   igual que antes; lo único nuevo es quién la invoca. Por eso `--paralelo=1` no es un modo
   degradado: es el mismo camino.
2. **La salida se imprime en el orden declarado**, no en el de terminación. Un banco cuya
   salida cambia de orden entre corridas no se puede leer en un diff de CI.
3. **El contrato entre padre e hijo es una marca en la salida** (`__BANCO_JSON__` + JSON),
   no un canal de IPC. Es lo que mantiene al hijo invocable a mano (`--solo=x --json`) y al
   banco sin dependencias (ADR [0002](0002-sin-dependencias.md)). El costo: todo caso futuro
   tiene que entregar esa marca al final y ninguna otra línea puede empezar con ella.

Y el `quickstart` dejó de correr el self-test suelto: era el mismo comando que la primera
señal del gate anidado que corre dos líneas después. **−14s sin perder una afirmación.**

## Consecuencias

- El gate pasó de **129s a ~82s**; el banco, de 77.7s a ~33s. El **self-test es ahora el
  camino crítico** (44s), y ahí las secciones caras son las mismas de siempre por la misma
  razón: §8 (perfiles y ejemplos) y §3 (los frenos muerden), las dos en serie.
- **La ganancia depende de los núcleos.** En un runner de dos, el paralelismo es 2 y el
  `quickstart` (32s, dos gates anidados) domina el total: el número de arriba es de una
  máquina de diez y no se puede publicar como el de CI sin medirlo ahí.
- **Tres maneras nuevas de reportar verde sin haber probado nada**, todas con caso propio en
  el self-test (P2): un nombre de caso que no existe, `--solo=` sin valor —pedías uno y
  corrían nueve— y un hijo que revienta sin entregar. La última necesitó una costura
  (`--hijo-mudo=`): es el único camino que no se puede provocar a mano, y sólo puede poner el
  banco más rojo.
- El bug de fondo ya estaba antes de este cambio: `--solo=inexistente` imprimía
  `BANCO VERDE — 0 comprobaciones` y salía 0. Inofensivo mientras el flag lo escribía un
  humano; letal desde que **el padre invoca a los hijos por nombre**.

## Alternativas descartadas

- **Caché por hash de las entradas.** Un verde que nadie verificó es exactamente lo que este
  repo predica contra (P1: omitido no es verde, y cacheado tampoco).
- **Correr sólo los casos tocados por el diff.** Sirve para `gate:fast` y para el pre-commit,
  nunca para el entregable.
- **Un pool de workers en vez de procesos.** Los casos ya se invocan como procesos desde la
  línea de comandos; un worker compartiría estado de módulo y haría de la independencia —que
  hoy es un hecho del diseño— algo que habría que cuidar a mano.

# ADR 0014 — El self-test corre en abanico, y el grupo es la frontera del estado

- **Fecha:** 2026-10-14
- **Estado:** aceptado
- **Relacionado:** [0006](0006-banco-en-paralelo.md), [0003](0003-selftest-generado.md), [0004](0004-contrato-de-hooks.md)

## Contexto

Después de [0006](0006-banco-en-paralelo.md) el banco corría en paralelo, pero el gate seguía
siendo, casi entero, **arranque de procesos en serie** (#32). Medido por dentro, con un
perfilador de `spawnSync` por línea de llamada:

- el **link-check** lanzaba un `git check-ignore` por cada entrada del árbol que recorría:
  ~180 procesos y ~2s por corrida. Corre una vez en el gate, una por cada perfil en §8 del
  self-test, una por cada stack del banco y una por cada gate anidado del `quickstart`;
- el **`quickstart`** del banco corría dos gates completos (el verde y el de la capa pura
  rota) uno detrás del otro, y era el camino crítico del banco;
- el **self-test** era una cola larga de ~70ms por `node`: ninguna sección dominaba, §3
  (los frenos muerden), §8 (perfiles) y §9 (costo) sumaban dos tercios.

## Decisión

1. **El link-check pregunta a git una sola vez** qué ignora (`git ls-files --others
   --ignored --exclude-standard --directory`): una ruta está ignorada si ella o un padre está
   en la lista. Mismo veredicto, dos procesos en vez de ~180.
2. **Los dos gates del `quickstart` corren a la vez, cada uno en su copia** del repo
   instalado. La copia roja lleva el archivo roto; la verde no lo ve; ninguna comparte `.git/`.
   Sobre el mismo repo sería una carrera, y un falso verde por carrera es peor que lento.
3. **El self-test corre en partes**, un proceso por parte, tantas a la vez como núcleos.
   El padre no prueba: junta, e imprime los bloques en el orden declarado (el contrato de
   [0006](0006-banco-en-paralelo.md)). Cada hijo entrega su número de fallos con una marca
   en la salida.

Lo que no es detalle de implementación:

- **El grupo es la frontera del estado compartido.** Los casos que leen o escriben los
  marcadores de sesión de ESTE repo (`gate.marker`, `askFirst.marker`, `loop.*`) van en la
  parte `estado`, y §9 (`hooks-timing`, que respalda y restaura esos mismos archivos) en la
  parte `costo`, del **mismo grupo**: corren en serie, en el mismo turno del pool. Todo lo
  demás opera por stdin o en temporales propios. Un caso nuevo que toque esos marcadores
  fuera del grupo es el bug, y el reviewer lo tiene que ver.
- **Apartar el estado del ciclo acotado ocurre en un solo proceso.** Hecho en cada hijo a la
  vez, el segundo respaldaría el «vacío» que dejó el primero y al devolverlo borraría la
  escalada real del desarrollador.
- **P7 se mide dos veces.** El 4f de la parte `reglas` corre con las demás todavía andando,
  así que el padre repite el barrido de residuos con todas terminadas.
- **`--parallel=1` no es un modo degradado:** es el mismo código, en un proceso, en vivo.
  Las dos formas dan el mismo conjunto de comprobaciones (diff ordenado idéntico).
- **Tres maneras nuevas de reportar verde sin probar nada**, con caso propio (P2): una parte
  que no existe, `--parts=` sin valor, y una parte que falla o no entrega —esta con dos
  costuras, `--fail-part` y `--mute-part`, que sólo pueden poner el resultado más rojo—. El
  mismo caso verifica que la salida sale en el orden declarado aunque las partes se pidan al
  revés.

## Consecuencias

- Medido en la misma máquina (10 núcleos), **alternando** corridas de `main` y de esta rama
  para que las dos vean la misma carga — la máquina estaba compartida (load 6–29) y un número
  suelto no se puede comparar con otro tomado diez minutos después:

  | | `main` (2 corridas) | esta rama (2 corridas) |
  |---|---|---|
  | **gate completo** | 205.5s · 164.9s | **40.1s · 35.6s** |
  | harness self-test | 123.0s · 87.2s | 15.9s · 15.6s |
  | profile bench | 74.8s · 71.3s | 19.3s · 15.2s |
  | harness cost | 4.0s · 4.0s | 4.1s · 3.9s |
  | docs link-check | 3.0s · 1.8s | 0.2s · 0.2s |

  Con menos carga el `main` medía 98–129s ([0006](0006-banco-en-paralelo.md), #32); la
  proporción es la que importa: **~4×**. Rebasada sobre el `main` que trajo la tarea
  declarada y el investigador de CI, otra vez alternando: `main` 180.1s · 224.5s, esta rama
  45.6s (y 87.1s en una corrida que cayó en un pico de load 32).
- El self-test ganó cuatro comprobaciones (573 → **577** sobre el `main` rebasado): las tres
  del abanico y una del link-check (citar un archivo dentro de un directorio ignorado es
  rojo). **Ningún caso se perdió**: el diff ordenado de las comprobaciones en serie
  (`--parallel=1`) y en abanico es idéntico.
- El camino crítico del self-test es ahora el grupo `estado` + `costo` (~16s): es el precio
  de no cruzar los marcadores de sesión, y es deliberado.
- Como en [0006](0006-banco-en-paralelo.md), **la ganancia depende de los núcleos**: con dos,
  el abanico es de dos.

## Alternativas descartadas

- **Caché por hash de las entradas** y **alcance por archivo cambiado:** los mismos motivos
  que en [0006](0006-banco-en-paralelo.md) — un verde que nadie verificó, y un entregable
  que depende de qué tocaste.
- **Paralelizar dentro de cada sección** (prefetch asíncrono de cada `runHook`): tocaba
  cientos de casos uno por uno para el mismo resultado que agruparlos por proceso.
- **El gate en abanico** (la tarea A de #32: señales a la vez, `exclusive: true` para la
  latencia). Medido antes de construirlo: self-test y banco **juntos** tardan 25.9–27.3s
  contra 15.6 + 15.2 = 30.8s en serie, porque cada uno ya ocupa todos los núcleos por dentro.
  Son ~5s sobre ~36s a cambio de una clave nueva del config, de perder la salida en vivo del
  gate, y de un modo que en un repo portado sería peligroso por defecto (un `build` y un
  `test` que escriben el mismo `dist/`). No paga. Se reabre si una señal nueva, lenta y que
  no se abanica sola, entra al gate.

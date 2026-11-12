# ADR 0019 — El gate incremental: modos de desarrollo, caché, carriles y cerrojo

- **Fecha:** 2026-11-12
- **Estado:** aceptado
- **Relacionado:** [0004](0004-contrato-de-hooks.md) (lo roto deja pasar, no decide), [0017](0017-status-como-bitacora.md) (la bitácora anota veredictos), [0018](0018-limites-por-diseno.md) (límites por diseño)

## Contexto

El gate corría todas las señales, en serie, siempre. En este repo eso son tres minutos; en un repo
portado con suites de producto fueron veintiuno, y arreglar un hook costaba repetirlos enteros. Un
gate caro no se corre: se saltea, o se pide que lo saquen. El costo del gate es un riesgo para P1,
no una incomodidad.

Las mejoras nacieron en ese repo portado y se trajeron acá sin lo que era suyo: lo que allá estaba
escrito en el código (una carpeta de clones, un gestor) acá es una clave del config.

## Decisión

1. **Modos de desarrollo que no entregan.** `changed` corre sólo las señales cuyo alcance (`paths`)
   toca lo cambiado desde el último gate **completo**; `retry`, sólo las que quedaron rojas o
   abortadas. Ninguno borra `gate.marker`, anota la bitácora ni habilita un despliegue: el único
   entregable sigue siendo el gate completo (P1 no cambia).
2. **Caché por señal, también en el gate completo.** Una señal con `paths` cuyas entradas son las de
   su último verde no se vuelve a correr y cuenta verde. Las entradas son su definición, la versión
   de node y el **contenido** que git tiene de cada ruta, más lo sucio adentro.
3. **Carriles.** Las señales de un mismo `lane` corren en serie; carriles distintos, a la vez.
4. **Cerrojo con adopción.** Un segundo gate sobre el mismo árbol espera; si el primero corrió
   completo sobre el mismo HEAD con el árbol limpio, adopta su veredicto.
5. **Estados honestos.** Una señal colgada se corta con su árbol y es roja; una que no llegó a
   medir es `abortada`: tiñe el veredicto y no gasta el presupuesto del ciclo acotado.

Todo es opt-in y fail-safe: sin `paths` la señal corre siempre y no se cachea; sin `lanes`, en
serie; un `paths` mal formado es rojo.

## Qué significa ahora «gate verde»

Antes: «cada señal corrió recién y pasó». Ahora: «cada señal pasó sobre estas entradas», donde
algunas mediciones pueden ser de una corrida anterior con las mismas entradas. Es la misma
garantía **si `paths` dice la verdad**, y esa es la condición que se acepta.

## Lo que se acepta a sabiendas

- **Un `paths` incompleto deja cacheada una señal que debió correr.** Por eso sólo lo declaran las
  señales caras, y el self-test corre siempre.
- **La firma ve lo que git ve.** Un archivo ignorado bajo `paths` no entra: una señal que depende
  de un derivado declara `cache: false`.
- **Lo que no es un archivo no está en la firma** (el toolchain, el entorno, un servicio):
  `--no-cache` mide en frío.
- **El registro es de confianza local** (`.git/harness-gate.json`): quien lo escribe decide la
  caché. CI arranca sin registro y por eso siempre mide.
- **El cerrojo no es atómico**: dos gates que arrancan en el mismo instante pueden tomarlo los dos.
  Cubre el caso real —una sesión que lanza el gate mientras otro corre—, no una carrera.

## Lo que se descartó

- **Cachear sin `paths`**, deduciendo las entradas: adivinar de qué depende un comando ajeno es
  cablear un stack, y equivocarse da un verde falso.
- **Que `changed` verde entregue**: dejaría el entregable a merced de un `paths` bien escrito.
- **Dejar cerrar un turno de pregunta con el gate pendiente** (venía en el mismo lote): sería una
  segunda excepción del hook `Stop`, y P1 nombra una sola. Si se quiere, es una enmienda de la
  constitución en su propio commit.

## Prueba de vida

Self-test, secciones 6-bis (carriles y cerrojo), 6-ter (`retry`), 6-quater (`changed`),
6-quater-bis (repos anidados), 6-quinquies (abortada y colgada) y 6-sexies (caché, incluido el
nombre de archivo no ASCII que dejaba un verde falso).

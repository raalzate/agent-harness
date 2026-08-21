# SDD — cuándo el trabajo arranca con spec

Spec-Driven Development **no es el modo por defecto** de un repo: es la ruta para el trabajo que
crea superficie nueva (una pantalla, un endpoint, un formato de intercambio, un módulo). Para un
cambio acotado y reversible, el ceremonial cuesta más de lo que protege.

Lo que el arnés aporta acá no es un kit: es que **la decisión se tome y se declare**. El hook
`sdd-router` (UserPromptSubmit) pone el criterio delante del agente **antes** de que edite, y la
regla dura es:

> **Saltarse SDD es una decisión que se declara, no un silencio.**

Si el agente no declara nada y editó producción en algo de tamaño feature, eso es un hallazgo de
review — el `reviewer` lo busca explícitamente.

## La decisión

| Señal en el pedido | Ruta |
|---|---|
| Feature, módulo, pantalla o formato nuevo; epic; MVP; historias de usuario | **SDD completo** |
| Endpoint, servicio o contrato de intercambio nuevo | **SDD completo** |
| Migración, rearquitectura, reescritura | **SDD completo** |
| Falla concreta sobre algo que ya existe | **test rojo primero**, después el arreglo |
| Requisito ambiguo antes de arrancar | preguntar **una** cosa antes de tocar archivos |
| Copy, i18n, typo, tooltip | sin SDD |
| Renombrar, formatear, mover, documentar | sin SDD |
| Pregunta, auditoría, explicación | sin SDD |
| Cambio acotado y reversible sin superficie nueva | sin SDD, **declarando en una línea por qué no aplica** |

Ese cuadro es exactamente lo que codifica `sdd.routes` en el config: cada ruta tiene sus patrones y
su mensaje. Un mensaje vacío significa "esta clase de pedido es trivial, callate" — un router que
habla siempre deja de leerse, y ahí perdiste el freno.

## Con kit o sin kit

**Sin kit** (el default de este repo): `phases: []`. El valor está en el ruteo y en que la ruta
elegida quede escrita. El spec puede ser un issue con criterios de aceptación; lo que importa es
que exista **antes** del código y que se pueda cerrar.

**Con kit** (Spec Kit, Intent Integrity Kit, o uno propio): listá las fases en `sdd.phases` y los
directorios donde viven en `sdd.skillRoots`. El self-test verifica que las skills nombradas
**existan de verdad** en la máquina del desarrollador, y en CI reporta la ausencia como *omitido*,
nunca como "pasó". Es el antídoto de la fase fantasma: un flujo documentado que nadie puede correr.

Una fase que casi ningún kit trae y vale la pena: **generar los escenarios de prueba con un hash de
integridad antes de escribir el código**, y verificar ese hash al implementar. Es la versión
ejecutable de "jamás se ajusta una aserción para que pase el test".

## Dónde viven los artefactos

Dos opciones, y conviene elegir a conciencia:

**En el repo** (`specs/`): viajan con el clon, se versionan con el código, se revisan en el mismo
PR. Cuesta: no se pueden asignar, no tienen estado propio, y los lee sólo quien ya clonó.

**En el gestor de issues:** la issue madre lleva el spec, cada tarea es su propio issue —
asignable, cerrable, con historial— y el avance se ve sin `git pull`. Cuesta: hace falta red, y el
artefacto ya no viaja con el código.

La regla que sirve en cualquiera de las dos: **elegí una y hacela verificable**. Si decidís que los
specs no van al repo, agregá una señal al gate que se ponga roja cuando aparezca un archivo bajo
`specs/` fuera de lo permitido. Sin ese freno, en tres meses tenés las dos cosas a medias.

Lo que **siempre** se queda en el repo es lo que explica el código: decisiones (`docs/decisions/`),
arnés (`docs/arnes.md`) e incidentes (`docs/gotchas.md`).

## Cómo convive con las otras reglas

- **El gate no cambia.** Con o sin SDD, nada se entrega sin gate verde.
- **TDD sigue mandando.** Tener spec no reemplaza el ciclo rojo → verde → refactor.
- **Los principios mandan sobre el spec.** Un spec de producto no deroga la constitución: si pide
  algo que viola un principio BLOCKING, se enmienda la constitución (commit propio, versión subida)
  o se cambia el spec. La excepción en silencio no es una opción.

## Qué es ejecutable y qué no

| Regla | Mecanismo |
|---|---|
| El pedido de tamaño feature se rutea o se declara | `sdd-router` inyecta el criterio en cada prompt que dispara — **informa, no bloquea**: la intención no es verificable por máquina |
| El clasificador no se degrada | el self-test prueba una muestra por ruta, y que el router se calle en lo trivial |
| El kit nombrado existe de verdad | el self-test exige cada fase en `skillRoots` (omitido en CI, nunca "pasó") |
| El puntero de feature activa resuelve | el self-test: un puntero colgado es gate rojo |
| Los artefactos no vuelven al repo (si esa fue la decisión) | una señal propia del gate; el arnés no la trae puesta porque la decisión es de cada equipo |

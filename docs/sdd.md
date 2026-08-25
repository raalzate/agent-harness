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

Y una decisión anterior a todas, que se toma con el humano y no en soledad: **¿este cambio se
registra?** El ruteo la pone delante (ruta `issue`) y el hook `commit-msg` la hace inevitable —
un commit de código sin referencia ni declaración no entra al historial. El mecanismo completo, y
cómo se configura en cada forja, está en [trazabilidad.md](trazabilidad.md).

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

Dos casas posibles —el repo o el gestor de trabajo— con sus ventajas y sus costos enfrentados en
[trazabilidad.md](trazabilidad.md). Acá importa una sola cosa: **elegí una y hacela verificable**.
La señal existe y no toca la red, así que corre igual en tu máquina y en CI:

```bash
node scripts/artifacts-check.mjs
```

Si el equipo eligió el gestor, la feature es un **árbol de ítems** — la forma es la misma en GitHub,
GitLab, Azure Boards o Jira, sólo cambian los nombres:

```
<ítem MADRE>   spec en el cuerpo; plan · checklist · escenarios · análisis como comentarios
 ├─ <tarea 1>  asignable, cerrable, con su verificación escrita
 ├─ <tarea 2>
 └─ …          etiquetas: «feature» | «tarea» + una que agrupe por feature
```

El flujo de punta a punta, con el CLI que corresponda (`gh`, `glab`, `az boards`, `tea`…):

```bash
# 1. el skill de spec escribe el markdown en el SCRATCHPAD, no en el repo
# 2. se abre el ítem madre con ese markdown como cuerpo
# 3. plan, checklist y escenarios entran como comentarios del ítem madre
# 4. una tarea = un ítem hijo, enlazado a la madre
# 5. el puntero de la feature en curso guarda el NÚMERO del ítem madre
```

Automatizarlo es un script de una tarde y conviene que sea **el único** que habla con la forja: así
cambiar de gestor toca un archivo. Ese script no va al gate —necesita red y credenciales—; lo que sí
va es `artifacts-check`, que sólo mira el sistema de archivos.

## Cómo convive con las otras reglas

- **El gate no cambia.** Con o sin SDD, nada se entrega sin gate verde.
- **TDD sigue mandando.** Tener spec no reemplaza el ciclo rojo → verde → refactor.
- **Los principios mandan sobre el spec.** Un spec de producto no deroga la constitución: si pide
  algo que viola un principio BLOCKING, se enmienda la constitución (commit propio, versión subida)
  o se cambia el spec. La excepción en silencio no es una opción.

## Qué es ejecutable y qué no

| Regla | Mecanismo |
|---|---|
| Un commit de código queda registrado | `.githooks/commit-msg`: referencia del ítem o `sin-issue: <motivo>`. **Es el único freno BLOCKING de esta página** |
| Los artefactos están donde el equipo decidió | `node scripts/artifacts-check.mjs` en el gate, sin red |
| El pedido de tamaño feature se rutea o se declara | `sdd-router` inyecta el criterio en cada prompt que dispara — **informa, no bloquea**: la intención no es verificable por máquina |
| El clasificador no se degrada | el self-test prueba una muestra por ruta, y que el router se calle en lo trivial |
| El kit nombrado existe de verdad | el self-test exige cada fase en `skillRoots` (omitido en CI, nunca "pasó") |
| El puntero de feature activa resuelve | el self-test: un puntero colgado es gate rojo |
| El registro es el *correcto* (issue madre con tareas y no un bug suelto) | ninguno: es criterio del agente y del `reviewer`. El freno pide *un* registro, no el adecuado |

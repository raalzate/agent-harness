# ADR 0018 — Límites por diseño: lo que el arnés no hace a propósito

- **Fecha:** 2026-11-05
- **Estado:** aceptado
- **Relacionado:** [0017](0017-status-como-bitacora.md) (la bitácora de STATUS.md), [0002](0002-sin-dependencias.md) (sin dependencias), [0003](0003-selftest-generado.md) (self-test generado), [0005](0005-indice-obligatorio.md) (índice obligatorio)

## Contexto

La «Deuda conocida» de `STATUS.md` mezclaba dos cosas distintas:

- **Deuda:** algo que falta y tiene un mecanismo posible. Se paga y se cierra.
- **Límites:** algo que el arnés no hace a propósito, porque hacerlo costaría más que el riesgo que
  cubre, o porque violaría otro principio (P3: no morder de más; sin dependencias; un gate
  reproducible).

Tener los límites anotados como deuda tenía dos costos. El número de deuda no bajaba nunca, así
que dejaba de decir algo. Y cada barrido de `/bitacora` volvía a preguntar por cosas que ya
estaban decididas.

## Decisión

Cada uno de estos ítems sale de la deuda con un evento `debt.closed` cuya evidencia es este ADR.
Queda escrito como límite, con cuatro datos:

- su porqué;
- la mitigación que existe hoy;
- **qué lo reabriría**: la señal de que dejó de ser un límite y pasó a ser deuda.

Si eso pasa, vuelve a la bitácora como `debt.opened`.

| Límite | Por qué no se cierra | Mitigación vigente | Lo reabre |
|---|---|---|---|
| **El ruteo de trabajo informa, no bloquea** | la intención de un pedido no es verificable por máquina; bloquear por una clasificación de texto frenaría pedidos legítimos (P3) | `sdd-router` lo dice en cada pedido; el `reviewer` marca la ruta saltada en silencio | un incidente donde una feature entró sin ruta y el `reviewer` no lo vio |
| **`bash.deny` es un guardarraíl, no un sandbox** | un agente puede reformular un comando; el aislamiento real es del sistema operativo o de un contenedor, no de un hook | reglas para bash y PowerShell, cada una con su muestra; `bash.ask` para lo que decide el humano; `harness-eval` mide los rodeos | un rodeo real que la evaluación determinista no tenga como caso |
| **El lint es regex sobre texto, sin AST** | un parser por lenguaje es una dependencia por stack (ADR 0002) y rompe el agnosticismo | las reglas anclan su contexto; el linter del stack va como señal del gate | una regla del lint que dé falsos positivos por comentarios o strings en un repo real |
| **El freno de registro pide *un* registro, no el *correcto*** | saber si el ítem es feature o bug exige consultar el gestor por red en cada commit, y el gate no depende de la red | `commit-msg` exige referencia o fuga firmada; `artifacts-check` y el `reviewer` juzgan la forma | un gestor con API local o un patrón de referencia que codifique el tipo |
| **El clasificador de intención es angosto** | ensancharlo bloquearía instrucciones legítimas: una pregunta mal leída como orden cuesta menos que una orden bloqueada | casos en dos idiomas y en las dos direcciones en el self-test y en `harness-eval` | un pedido informativo real tratado como acción que la evaluación pueda reproducir |
| **El aspecto visual de `docs/index.html`** | si la página «se ve bien» no lo juzga una máquina sin un navegador en el gate | `mentionSignals`, `mustLinkAll` y `GRIDLI` cubren lo verificable | una rotura visual con forma reconocible (como fue `GRIDLI`) |
| **Los perfiles se prueban en repos de juguete, no a escala** | un monorepo de 40 módulos en el gate lo vuelve lento e irreproducible | el banco instala los 8 stacks con archivos reales; con `--with-gate` (CI) el gate del repo portado sale VERDE tras los pasos de arranque | el primer portado a un repo de esa escala que destape algo: `/lesson` |
| **Ninguna señal del stack se ejecuta en el banco** | instalar SDKs (dotnet, JDK, Rust) en el gate lo vuelve irreproducible | el banco verifica el arnés sobre archivos reales; las señales del stack las corre el CI del repo portado | un perfil cuyo error sólo aparezca al compilar |
| **Nadie verifica que el agente consulte el índice antes de leer** | un hook no puede saber barato qué leyó el agente antes; un freno así mordería de más (P3) | `graph-first` lo recuerda en cada pedido de búsqueda; el `reviewer` lo juzga; plan en ADR 0005 | transcripciones que muestren lecturas a ciegas repetidas |

Hay dos casos que **no** son límites y se cerraron con un mecanismo. No van en esta tabla:

- El patrón de referencia demasiado ancho: se cerró con contra-muestras en el self-test.
- Las muestras que el generador no puede derivar: se cerraron con el campo `sample` por regla.

## Consecuencias

- La deuda de `STATUS.md` vuelve a ser accionable: cada ítem abierto tiene un mecanismo posible.
- Los límites siguen auditables. La bitácora registra cuándo y por qué cada uno salió de la deuda,
  y este ADR dice qué lo reabriría.
- **Lo que no se permite:** usar este ADR para cerrar deuda que sí tiene mecanismo. Un ítem nuevo
  entra acá sólo con su columna «Lo reabre» llena y si choca con un principio. Que sea caro, por sí
  solo, no alcanza.

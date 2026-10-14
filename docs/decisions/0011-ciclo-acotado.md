# ADR 0011 — El ciclo acotado lo cuenta el gate y lo destraba el humano

- **Fecha:** 2026-10-13
- **Estado:** aceptado
- **Relacionado:** #51, [config-reference.md](../config-reference.md) (`loop`), P12 de la constitución

## Contexto

P12 pedía «2 intentos sobre el mismo error; al tercero se para y se escala», pero era REVIEW: el
gate lo imprimía y nadie lo contaba. Peor, el hook `Stop` bloqueaba cerrar con el gate rojo, así
que el único camino que le dejaba al agente era reintentar: el bucle sin límite que la práctica 10
de XP aplicada a agentes («ciclos acotados, no actividad infinita») prohíbe.

## Decisión

1. **Cuenta el gate**, porque es el único que ve el resultado de cada intento. Por señal roja, una
   huella: la señal + la cola de su salida sin el ruido que cambia entre corridas (líneas,
   duraciones, hashes, fechas, temporales). Misma huella = un intento más; otra huella = hipótesis
   nueva, la cuenta vuelve a 1. No se borra cualquier número: «3 fallan» → «2 fallan» es progreso.
2. **Agotado, frena la edición y deja cerrar.** `action-guard` deniega editar dentro del repo y
   `gate-stop` deja de obligar a seguir. Es la única excepción del hook `Stop` a P1, y la
   Precedencia ya la resolvía: el agente para y escala.
3. **Lo destraba el humano**, con cualquier pedido. Vive en `ask-first` y no en un hook propio:
   cada hook de pedido es un arranque de node en CADA prompt, y `ask-first` ya corre ahí y ya
   maneja el otro marcador que levanta el humano. Es una segunda responsabilidad en el mismo
   hook, aceptada por latencia; si crece una tercera, se separa.
4. **Sin la clave, nada cambia**: el gate sigue con `stdio: "inherit"`. Con ella, la salida va por
   pipe para guardar la cola, y las herramientas que detectan terminal cambian su reporter.

## Consecuencias

- Lo que no pasa por el gate no cuenta como intento (correr `npm test` a mano diez veces).
- Una escritura por Bash con el presupuesto agotado no la ve `action-guard`; `bash.deny` sí frena
  borrar o reescribir el marcador y el libro. Hueco declarado en `STATUS.md`.
- Que el diagnóstico de la escalada sea bueno sigue siendo juicio del `reviewer`.

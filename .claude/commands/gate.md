---
description: Corre el gate del repo e interpreta el resultado.
argument-hint: "[changed|retry|fast]"
allowed-tools: Bash, Read, Grep, Task
---

Modo pedido: `$ARGUMENTS`. Vacío = completo, el único entregable. `changed` = sólo las señales que
tocan lo cambiado desde el último gate completo; es el ciclo para arreglar el arnés. `retry` = sólo
las rojas de la última corrida. `fast` = omite las lentas. Los tres son señal de desarrollo. La
tabla de qué gate corre cuándo está en `docs/arnes.md` § «Qué gate corre cuándo».

1. Delegá la corrida al subagente `gate-runner` para que el log no entre a este contexto.
2. Si el veredicto es VERDE: decilo con las señales que corrieron. `changed`, `retry` o `fast` verde
   **no es entregable**, y una señal **omitida** tampoco es verde. En `changed`, nombrá las rojas
   ajenas que el gate informa al final.
3. Si es ROJO:
   - leé el error real (archivo, línea, mensaje) antes de tocar nada;
   - arreglá **la causa**, jamás la aserción;
   - volvé a correr con `changed`, que repite sólo lo que tu arreglo toca, y cerrá con el gate
     completo.
4. Presupuesto: 2 intentos sobre el mismo error. Al tercero parás y escalás con el diagnóstico
   (qué probaste, qué descartaste, qué falta saber).

Nunca reportes "listo" sin gate completo verde.

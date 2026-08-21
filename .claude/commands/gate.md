---
description: Corre el gate del repo e interpreta el resultado.
argument-hint: "[fast]"
allowed-tools: Bash, Read, Grep, Task
---

Modo pedido: `$ARGUMENTS` (vacío = completo; `fast` = omite las señales lentas, señal de desarrollo).

1. Delegá la corrida al subagente `gate-runner` para que el log no entre a este contexto.
2. Si el veredicto es VERDE: decilo con las señales que corrieron. `fast` verde **no es entregable**;
   una señal **omitida** tampoco es verde.
3. Si es ROJO:
   - leé el error real (archivo, línea, mensaje) antes de tocar nada;
   - arreglá **la causa**, jamás la aserción;
   - volvé a correr el gate.
4. Presupuesto: 2 intentos sobre el mismo error. Al tercero parás y escalás con el diagnóstico
   (qué probaste, qué descartaste, qué falta saber).

Nunca reportes "listo" sin gate completo verde.

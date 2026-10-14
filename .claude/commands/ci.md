---
description: Lee el fallo del pipeline remoto (CI) con el CLI de la forja y lo explica con evidencia.
argument-hint: "[rama | --run <id>]"
allowed-tools: Bash, Read, Grep, Task
---

Pedido: `$ARGUMENTS` (vacío = la rama actual; una rama = esa; `--run <id>` = esa corrida).

1. Delegá la lectura al subagente `ci-investigator` para que el log del pipeline no entre a este
   contexto. Él corre `node scripts/ci-investigate.mjs` con lo pedido.
2. **OMITIDO** no es verde: sin CLI de la forja o sin credenciales no sabés si CI pasa. Decilo con
   el motivo; no cambies cuentas ni credenciales.
3. **ROJO**: antes de tocar nada, leé la línea real del error y el cruce con el gate local:
   - verde acá y roja en CI → es el entorno (SO, rutas, shell, variables): el arreglo va en el
     código que asumió el entorno, con su caso de prueba, no en el pipeline;
   - roja también acá → corré el gate local y arreglá ahí primero (`/gate`).
4. Presupuesto: 2 intentos sobre el mismo error. Al tercero parás y escalás con el diagnóstico.

Nunca digas «es flaky» sin la línea del error que lo demuestra.

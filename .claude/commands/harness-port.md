---
description: Instala este arnés en otro repositorio y deja el gate verde allá.
argument-hint: "<ruta del repo destino>"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

Repo destino: **$ARGUMENTS**

Seguí `docs/portar.md`. Resumen ejecutable:

1. `node scripts/harness-init.mjs $ARGUMENTS` — copia hooks, scripts, subagentes, comandos,
   `.githooks/` y un `harness.config.json` **de arranque**. No sobreescribe nada existente sin
   decirlo.
2. Explorá el repo destino y **averiguá sus señales reales** (comando de tests, de tipos, de
   build, de lint). No las inventes: leé su manifiesto y su CI.
3. Escribí `gate.signals` con esas señales, cada una con su `why`. Una señal sin motivo no entra.
4. Traducí las reglas del repo destino a reglas de config:
   - qué rutas nunca toca el agente → `protectedPaths`
   - qué comandos son irreversibles ahí → `bash.deny`
   - qué capa tiene que quedar pura → `purity`
   - qué registro es fuente única de verdad → `singleSource`
   - qué archivo tiene invariantes que no se tocan → `invariants`
   - qué dependencias están vetadas → `forbiddenDeps`
5. `cd $ARGUMENTS && npm run selftest && npm run gate` (o el equivalente del stack). Verde o no
   está portado.
6. Escribí allá su `CONSTITUTION.md` y su `STATUS.md` desde `plantillas/`, con los principios que
   **ese** proyecto puede hacer cumplir hoy. Un principio BLOCKING sin comando es REVIEW.

Al cerrar, informá qué quedó vivo, qué quedó como deuda declarada y el nivel de madurez alcanzado.

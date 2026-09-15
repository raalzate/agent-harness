---
description: Prueba de vida del arnés — para cada regla, ¿qué comando falla si alguien la viola?
allowed-tools: Bash, Read, Grep, Glob
---

Auditá el arnés de ESTE repo contra `docs/buenas-practicas.md`. El falso positivo que buscás
es **"instalado y muerto"**: archivos presentes cuyo eslabón activador nunca corre.

## Evidencia que hay que recolectar (comandos, no impresiones)

1. `npm run selftest` — ¿los hooks bloquean lo que dicen bloquear?
2. `npm run lint:rules` — ¿qué reglas están activas de verdad?
3. `git config core.hooksPath` — ¿el pre-commit está instalado (`.githooks`) o `.git/hooks/`
   sólo tiene `.sample`?
4. `npm run linkcheck` — ¿alguna instrucción del arnés apunta a la nada?
5. `.github/workflows/` — ¿CI corre **el mismo** gate que el humano?
6. `.claude/settings.json` vs `.claude/hooks/` — ¿hay hooks en disco que nadie declara?
7. `CONSTITUTION.md` — ¿cada principio BLOCKING nombra un comando que falla? Los que no,
   están mal clasificados: son REVIEW.
8. `codegraph status` — ¿hay índice del código y está sincronizado? Sin índice, la señal del gate
   sale **OMITIDA** (y omitido no es verde): el agente está leyendo el repo a mano. Ver
   `docs/codegraph.md`.
9. **CI/CD** (`docs/cicd.md`) — ¿el job corre el **mismo** `gate.command`? ¿alguna etapa tolera
   fallos? ¿el despliegue depende del gate verde o corre al lado?
10. **Diseño** (`docs/arquitectura.md`) — ¿qué regla del config sostiene cada frontera de capas?
    Una frontera sin regla (`purity`, `forbiddenDeps`, `singleSource`) es una frontera muerta.
11. **Agilidad** (`docs/agilidad.md`) — de los principios de esa tabla, ¿cuáles tienen hoy
    mecanismo vivo en ESTE repo y cuáles quedaron en prosa?

## Salida

Una tabla `Regla | Mecanismo | Comando que falla si se viola | ¿Vivo?` y, al final, el nivel de
madurez (L0–L4 de `docs/buenas-practicas.md`) con la evidencia que lo sostiene. Toda regla cuya
respuesta sea "ninguno, confiamos" va listada como **muerta**, con la propuesta del mecanismo más
fuerte disponible para revivirla.

No arregles nada en este comando: auditar y proponer. Los arreglos van por `/lesson`.

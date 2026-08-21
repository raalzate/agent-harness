---
description: Ciclo RHO — convierte un incidente en una mejora del arnés que pasó el gate.
argument-hint: "<incidente en una línea>"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Task
---

Incidente: **$ARGUMENTS**

Ejecutá el ciclo RHO completo. No pares en la fase 1.

## Fase 1 — Minería

Reconstruí qué pasó de verdad: comando que falló, salida real, cuántos intentos costó, qué
hipótesis fueron falsas. Si el incidente **ya está** en el registro de gotchas, el hallazgo es
otro: **la regla existía y no frenó nada** → hace falta un mecanismo más fuerte, no otra entrada.

## Fase 2 — Codificar en el mecanismo MÁS FUERTE disponible

| Mecanismo | Fuerza | Dónde vive |
|---|---|---|
| Test o validación en el código | máxima | la suite del proyecto |
| Regla en `.claude/harness.config.json` (lint, ruta protegida, comando denegado, reuso) | alta | JSON, sin tocar código |
| Hook nuevo o señal nueva del gate | alta | `.claude/hooks/`, `gate.signals` |
| Comando o script | media | `.claude/commands/`, `scripts/` |
| Entrada en memoria | baja | `docs/gotchas.md`, `CLAUDE.md` |

Markdown es el ÚLTIMO recurso, no el primero. Si elegís markdown, escribí explícitamente por qué
la regla no es verificable por máquina.

Si agregaste un freno, agregá **también su caso al self-test**: un freno sin prueba de vida es
decorativo. Si el freno es una regla del config, el self-test lo cubre solo.

La entrada de gotcha va en formato fijo: **Síntoma → Causa → Regla → Mecanismo**.

## Fase 3 — Validación por regresión (esta fase es el diseño entero)

Corré el gate. Verde → la mejora queda. Rojo → se revierte y se documenta el intento fallido.
Sin esta fase, "auto-mejora" es el agente reescribiendo sus propias reglas sin control.

Cerrá informando: incidente → mecanismo elegido → **comando que ahora falla** si alguien lo repite.

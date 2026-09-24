---
description: Evalúa un cambio de diseño con el índice del código — acoplamiento, cohesión y el ADR que falta.
argument-hint: "<símbolo, módulo o cambio propuesto>"
allowed-tools: Bash, Read, Grep, Glob, Task
---

Cambio en evaluación: **$ARGUMENTS**

Criterio completo: `docs/arquitectura.md`. No opines sobre acoplamiento sin medirlo.

## 1. Medir antes de mover (no negociable)

1. `codegraph status` — si el índice no está, **pará acá** y decilo: sin índice, todo lo que sigue
   es estimación de memoria. Cómo se instala: `docs/codegraph.md`.
2. `codegraph explore "$ARGUMENTS"` — de ahí salen los tres números que importan:
   - **quién depende** de esto (entrantes),
   - **de qué depende** esto (salientes),
   - **radio de impacto**: qué se rompe si cambia la firma.
3. Abrí archivos **sólo** donde el índice señaló, y sólo ese fragmento.

## 2. El veredicto

Contestá las tres preguntas, en una línea cada una:

- **¿Baja acoplamiento o sube cohesión?** Cuál de las dos, y contra qué se mide (`purity`,
  `forbiddenDeps`, `singleSource`, `reuse`). "Queda más prolijo" no es respuesta.
- **¿El radio de impacto es el esperado?** Si es más grande, esa sorpresa **es** el hallazgo:
  reportala antes de seguir.
- **¿Qué frontera nueva crea?** Si crea una, va al config como regla, con su caso de self-test. Un
  límite recordado se cruza en el sprint siguiente.

## 3. Lo que queda escrito

- Decisión estructural → **ADR** en `docs/decisions/`, con la plantilla de ADR que hay ahí, en el
  **mismo commit** que el movimiento. Escrito después es una justificación, no una decisión.
- Frontera nueva → regla en `.claude/harness.config.json` + `npm run selftest` verde.
- Nada estructural → decilo explícitamente y no escribas un ADR de trámite.

## Salida

```
RADIO DE IMPACTO: <entrantes> ← `<símbolo>` → <salientes>   (fuente: codegraph explore)
MEJORA: acoplamiento | cohesión — <cuál, medido contra qué regla>
FRONTERA NUEVA: <regla del config> | ninguna
ADR: <docs/decisions/NNNN-…> | no corresponde, porque <motivo>
RIESGOS: <lo que el índice mostró y no esperabas>
```

No implementes en este comando salvo que te lo pidan: medir, decidir y dejarlo escrito.

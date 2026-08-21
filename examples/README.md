# Ejemplos de `harness.config.json` por stack

Cada archivo es una config **completa y realista**, no una plantilla vacía: es el resultado de
hacer las preguntas de [`../docs/portar.md`](../docs/portar.md) en ese stack.

| Archivo | Repo típico | Lo que muestra de particular |
|---|---|---|
| [`node-typescript.json`](node-typescript.json) | app o librería TS con vitest | `typecheck` como señal irremplazable; `purity` de la capa de dominio |
| [`python.json`](python.json) | servicio FastAPI/Django con pytest | `ruff` + `mypy` + `pytest` son tres señales; migraciones aplicadas = inmutables |
| [`go.json`](go.json) | servicio Go | `vet`/`build`/`test -race` no se reemplazan; `invariants` sobre el apagado ordenado |
| [`monorepo.json`](monorepo.json) | workspace con varios paquetes | el gate corre el workspace completo; `skipIfMissing` para clones parciales |
| [`infra-terraform.json`](infra-terraform.json) | repo de infraestructura | el arnés se invierte: `bash.deny` es la mitad del valor (planear sí, aplicar no) |

## Cómo se usan

```bash
cp examples/node-typescript.json <tu-repo>/.claude/harness.config.json
```

Y después **borrá lo que no aplique**. Una regla que no corresponde a tu repo es peor que ninguna:
entrena al equipo a ignorar los frenos, y ahí ya perdiste los que sí importaban.

Verificá siempre después de editar:

```bash
node scripts/harness-selftest.mjs   # ¿cada regla que escribiste muerde de verdad?
node scripts/repo-lint.mjs --rules  # ¿qué reglas quedaron activas?
node scripts/repo-lint.mjs          # ¿el repo pasa con las reglas nuevas?
```

Las tres, no una. El self-test prueba que los frenos muerden; el lint completo prueba que **no
muerden de más** — un freno que bloquea trabajo legítimo se desactiva a mano en una semana.

## La pregunta que ordena todo

Al copiar un ejemplo, para cada regla preguntá: **¿esto ya nos pasó?**

Las reglas que sobreviven son las que tienen una cicatriz detrás. Las demás son ruido bien
intencionado que gasta contexto del agente y paciencia del equipo. Empezá con pocas reglas reales
y dejá que los incidentes agreguen las siguientes (`/lesson`).

# Documentación

Cuatro capas, de la teoría al copiar y pegar. Si tenés diez minutos, leé la primera y la última.

## 1. Por qué (la teoría)

| Documento | Qué contesta |
|---|---|
| [buenas-practicas.md](buenas-practicas.md) | La guía de fondo, agnóstica de stack: qué es un arnés, las cinco decisiones del bucle, los pilares, los niveles de madurez L0–L4, el ciclo RHO. **Es el documento que hay que leer.** |
| [decisions/0001-arnes-portable.md](decisions/0001-arnes-portable.md) | Por qué la especificidad va en un JSON y no en el código, y por qué el gate es declarativo. |
| [decisions/0002-sin-dependencias.md](decisions/0002-sin-dependencias.md) | Por qué sólo `node` y `bash`, y qué precisión se resigna a cambio (el lint es regex, no AST). |
| [decisions/0003-selftest-generado.md](decisions/0003-selftest-generado.md) | Por qué el self-test deriva sus casos del config en vez de tener uno escrito por freno. |
| [decisions/0004-contrato-de-hooks.md](decisions/0004-contrato-de-hooks.md) | El contrato de exit codes, y por qué un arnés roto **deja pasar** en vez de bloquear. |

## 2. Cómo (la práctica)

| Documento | Qué contesta |
|---|---|
| [portar.md](portar.md) | **La receta.** Instalar el arnés en un repo cualquiera en una tarde, con la lista de preguntas que hay que contestar y el orden en que conviene contestarlas. |
| [config-reference.md](config-reference.md) | Cada clave de `.claude/harness.config.json`: qué hace, qué la lee, qué pasa si falta. |
| [trazabilidad.md](trazabilidad.md) | Que el trabajo quede registrado, en cualquier forja —GitHub, GitLab, Azure Boards, Jira, Gitea—: el hook que lo hace inevitable, cómo se configura el patrón de referencia, y dónde viven los artefactos de una feature. |
| [recetas.md](recetas.md) | Recetas por situación: cómo se ve el gate en cada stack, cómo se agrega una señal, cómo se mide si el arnés está vivo. |

## 3. Este repo (el ejemplo trabajando)

| Documento | Qué contesta |
|---|---|
| [arnes.md](arnes.md) | Cómo está montado el arnés **de este repo**, señal por señal y hook por hook. Es el ejemplo de referencia: se audita a sí mismo. |
| [sdd.md](sdd.md) | Cuándo el trabajo arranca con spec y cuándo no, y por qué saltarse la ruta se declara en vez de omitirse. |
| [gotchas.md](gotchas.md) | Incidentes reales del arnés, en formato fijo (síntoma · causa · regla · mecanismo). |

## 4. Para copiar

| Directorio | Contenido |
|---|---|
| [`../examples/`](../examples/README.md) | Configs completas por stack: TypeScript, Python, Go, monorepo, Terraform. |
| [`../plantillas/`](../plantillas) | `CONSTITUTION.md`, `CLAUDE.md`, `STATUS.md`, `gotchas.md`, `ADR.md` y una config de arranque. |

---

## La frase que resume todo

> **Una regla sin un comando que la haga fallar es una sugerencia.**

Todo lo demás en esta carpeta es la consecuencia operativa de esa frase.

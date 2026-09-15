# Documentación

Cuatro capas, de la teoría al copiar y pegar. Si tenés diez minutos, leé
[metodo.md](metodo.md) y el [caso de estudio](caso-de-estudio.md).

El orden que funciona: **el método** (qué se hace y por qué) → **el caso** (cómo se ve aplicado) →
**la receta** (cómo instalarlo acá) → **la referencia** (qué significa cada clave).

## 1. Por qué (la teoría)

| Documento | Qué contesta |
|---|---|
| [metodo.md](metodo.md) | **El método.** El ciclo de trabajo, las diez leyes con su cicatriz y su mecanismo, y cómo se mide si se está aplicando o sólo se está hablando de él. |
| [caso-de-estudio.md](caso-de-estudio.md) | **La evidencia.** Un arnés real con números: qué había antes, qué tiene hoy, cuatro mecanismos con el incidente que los creó, y lo que ese repo declara que no cubre. |
| [buenas-practicas.md](buenas-practicas.md) | La guía de fondo, agnóstica de stack: qué es un arnés, las cinco decisiones del bucle, los pilares, los niveles de madurez L0–L4, el ciclo RHO. **Es el documento que hay que leer.** |
| [decisions/0001-arnes-portable.md](decisions/0001-arnes-portable.md) | Por qué la especificidad va en un JSON y no en el código, y por qué el gate es declarativo. |
| [decisions/0002-sin-dependencias.md](decisions/0002-sin-dependencias.md) | Por qué sólo `node` y `bash`, y qué precisión se resigna a cambio (el lint es regex, no AST). |
| [decisions/0003-selftest-generado.md](decisions/0003-selftest-generado.md) | Por qué el self-test deriva sus casos del config en vez de tener uno escrito por freno. |
| [decisions/0004-contrato-de-hooks.md](decisions/0004-contrato-de-hooks.md) | El contrato de exit codes, y por qué un arnés roto **deja pasar** en vez de bloquear. |
| [decisions/0005-indice-obligatorio.md](decisions/0005-indice-obligatorio.md) | Por qué el índice del código pasó de recomendación a requisito, y por qué su señal se omite en vez de fallar. |
| [agilidad.md](agilidad.md) | **Qué principio ágil tiene mecanismo y cuál es prosa.** Diez principios con el comando que falla cuando se violan, y la lista explícita de lo que este arnés NO hace cumplir. |
| [ciclo-desarrollo.md](ciclo-desarrollo.md) | **El modelo de ramas y las prácticas de XP, declarados.** `workflow` (trunk-based, git flow, GitHub flow) y `xp` (test primero, lote chico, refactor separado, de a dos): qué se verifica con un comando, qué se declara y no se finge verificado. |
| [arquitectura.md](arquitectura.md) | **Diseño con comando.** Qué documentación de arquitectura es obligatoria (y cuándo va un ADR), y la traducción de bajo acoplamiento / alta cohesión a reglas del config que fallan. |

## 2. Cómo (la práctica)

| Documento | Qué contesta |
|---|---|
| [quickstart.md](quickstart.md) | **Empezá acá.** De cero a gate verde en 10 minutos, con un to-do de cuatro archivos: el arnés instalado, tres frenos mordiendo con salida real, y el gate rojo a propósito. Todas las salidas del documento se corrieron tal como están escritas. |
| [portar.md](portar.md) | **La receta.** Instalar el arnés en un repo cualquiera en una tarde, con la lista de preguntas que hay que contestar y el orden en que conviene contestarlas. |
| [config-reference.md](config-reference.md) | Cada clave de `.claude/harness.config.json`: qué hace, qué la lee, qué pasa si falta. |
| [perfiles.md](perfiles.md) | **Portar a un repo que no es de Node.** Los perfiles de stack del instalador (.NET, JVM, Python, Go, Rust, front): qué hecho del lenguaje viaja en un perfil, qué regla no viaja nunca, y el freno que lo mantiene así. |
| [trazabilidad.md](trazabilidad.md) | Que el trabajo quede registrado, en cualquier forja —GitHub, GitLab, Azure Boards, Jira, Gitea—: el hook que lo hace inevitable, cómo se configura el patrón de referencia, y dónde viven los artefactos de una feature. |
| [codegraph.md](codegraph.md) | **El índice del código es obligatorio.** Qué cuesta leer el repo a mano, cómo se instala codegraph, cómo se consulta y qué mecanismo lo exige. |
| [cicd.md](cicd.md) | **El pipeline.** El mismo gate en tres lugares (humano, agente, CI), las cuatro reglas del pipeline y qué hacer cuando el gate tarda. |
| [multiplataforma.md](multiplataforma.md) | **Windows, macOS y Linux.** Qué corre con qué intérprete, las seis trampas que hacían que un freno no fallara sino que desapareciera, y la matriz de CI que lo demuestra. |
| [multi-proyecto.md](multi-proyecto.md) | **Varios proyectos.** Monorepo, varios repos o una plataforma entera: dónde va el gate, qué viaja entre repos y qué no, cómo se actualiza el arnés en N proyectos sin quedar desparejo. |
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
| [`../examples/`](../examples/README.md) | Veinticuatro configs completas por stack, por forja y por situación: TypeScript, React, Android/Kotlin, iOS/Swift, .NET, Spring, Python, Go, Rust, Rails, Laravel, Elixir/Phoenix, C++/CMake, firmware en C, Unity, datos (Airflow+dbt), monorepo, Terraform, un repo heredado, el quick start — y cuatro por **integración**: Azure DevOps, GitLab+monorepo, GitHub en una plataforma de varios repos, y Bitbucket+Jenkins. |
| [`../plantillas/`](../plantillas) | `CONSTITUTION.md`, `CLAUDE.md`, `STATUS.md`, `gotchas.md`, `ADR.md` y una config de arranque. |
| [`../plantillas/ci/`](../plantillas/ci) | El pipeline que corre el mismo gate, listo para copiar: [GitLab](../plantillas/ci/gitlab-ci.yml), [Azure Pipelines](../plantillas/ci/azure-pipelines.yml), [Bitbucket](../plantillas/ci/bitbucket-pipelines.yml) y [Jenkins](../plantillas/ci/Jenkinsfile). El de GitHub Actions es [`../plantillas/ci.yml`](../plantillas/ci.yml) y lo instala el instalador. |

---

## La frase que resume todo

> **Una regla sin un comando que la haga fallar es una sugerencia.**

Todo lo demás en esta carpeta es la consecuencia operativa de esa frase.

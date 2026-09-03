# Ejemplos de `harness.config.json` por stack

Cada archivo es una config **completa y realista**, no una plantilla vacía: es el resultado de
hacer las preguntas de [`../docs/portar.md`](../docs/portar.md) en ese stack.

| Archivo | Repo típico | Forja | Lo que muestra de particular |
|---|---|---|---|
| [`quickstart.json`](quickstart.json) | el to-do de cuatro archivos de [`quickstart.md`](../docs/quickstart.md) | GitHub `#123` | **el más chico que igual muestra las cuatro clases de freno**: capa pura, único lector, ruta protegida y comando sin ctrl-Z. Se lee de una sentada |
| [`node-typescript.json`](node-typescript.json) | app o librería TS con vitest | GitHub `#123` | `typecheck` como señal irremplazable; `purity` de la capa de dominio |
| [`python.json`](python.json) | servicio FastAPI/Django con pytest | GitLab `#123` | `ruff` + `mypy` + `pytest` son tres señales; migraciones aplicadas = inmutables |
| [`go.json`](go.json) | servicio Go | Jira `PROJ-123` | `vet`/`build`/`test -race` no se reemplazan; artefactos **en el repo**, no en el gestor |
| [`dotnet.json`](dotnet.json) | servicio ASP.NET Core con xUnit | Azure Boards `AB#1234` | `forbiddenDeps.matcher` para `<PackageReference>` y `purityImportSyntax` para `using`: sin los dos, DEPS y PUREZA salen verdes con la violación puesta |
| [`jvm-spring.json`](jvm-spring.json) | servicio Spring Boot con Maven | Jira `PAY-123` | `matcher` para `<artifactId>` en XML; `@Autowired` en campo como patrón prohibido; migraciones de Flyway inmutables |
| [`monorepo.json`](monorepo.json) | workspace con varios paquetes | Azure Boards `AB#123` | el gate corre el workspace completo; `skipIfMissing` para clones parciales |
| [`infra-terraform.json`](infra-terraform.json) | repo de infraestructura | Gitea `#123` | el arnés se invierte: `bash.deny` es la mitad del valor (planear sí, aplicar no) |

La columna **Forja** está a propósito: cinco gestores distintos con el mismo mecanismo. Ningún
script del arnés conoce ninguno — lo único que cambia es `tracker.issuePattern`. Ver
[trazabilidad.md](../docs/trazabilidad.md).

Los ocho archivos los verifica el gate (sección 8 del self-test): parsean, sus regex compilan,
cada señal declara su `why`, y un manifiesto que no es clave-valor trae su `matcher`. Un ejemplo
roto viaja igual que un script roto.

Si tu stack no está acá, el instalador tiene un **perfil** que llena lo deducible del lenguaje:
ver [perfiles.md](../docs/perfiles.md).

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

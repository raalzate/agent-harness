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
| [`front-react.json`](front-react.json) | SPA React + Vite con Playwright | GitHub `#123` | el bundle es **público**: `VITE_*` con un secreto, `dangerouslySetInnerHTML` y `key={index}` son patrones prohibidos; los e2e entran con `skipIfMissing` porque una señal que a veces no puede correr enseña a ignorar el rojo |
| [`android-kotlin.json`](android-kotlin.json) | app Android/Kotlin con Gradle | GitLab `#123` | `matcher` para la notación corta de Gradle (`"grupo:artefacto:version"`); `!!` y `GlobalScope` prohibidos; el keystore y los esquemas de Room en `protectedPaths` |
| [`rust.json`](rust.json) | workspace de crates + binario | Linear `ENG-123` | `clippy -- -D warnings` (sin `-D`, clippy imprime y sale 0: verde con los avisos puestos); `unsafe` acotado a un crate; `cargo publish` en `bash.deny` porque una versión de crates.io no se borra |
| [`ruby-rails.json`](ruby-rails.json) | monolito Rails con RSpec | GitHub `#123` | sin compilador la suite ES la señal, así que el freno de mayor retorno es ONLY (`:focus`/`fit` dejan la suite corriendo tres tests y el gate verde en veinte segundos); `db/schema.rb` protegido por ser derivado |
| [`php-laravel.json`](php-laravel.json) | app Laravel con Pest | Jira `WEB-123` | `bootstrap/cache` y `storage/framework` protegidos (editar un derivado ahí da un bug que se cura solo al limpiar caché); `migrate:fresh` es un DROP con otro nombre y vive en `bash.deny`; `env()` fuera de `config/` como patrón |
| [`swift-ios.json`](swift-ios.json) | app iOS con SwiftUI + SPM | Azure Boards `AB#4821` | casi ninguna señal corre sin macOS: `skipIfMissing` en swiftlint y en `xcodebuild`, y el dominio en su propio paquete para tener **una** suite rápida; `project.pbxproj` protegido; `try!`/`as!`/`fatalError` prohibidos |
| [`cpp-cmake.json`](cpp-cmake.json) | proyecto C++ con CMake + CTest | Gitea `#123` | la **misma** suite dos veces (ASan+UBSan y TSan): la carrera no la caza correr los tests otra vez, la caza el detector; `--Werror` en clang-format y `-Werror` en el build porque un aviso que no falla no existe |
| [`data-airflow.json`](data-airflow.json) | DAGs de Airflow + modelos dbt + notebooks | GitLab `#123` | el único que declara `lint.sourceExtensions` a mano (`.sql` y `.ipynb` no están en el default: sin declararlas, el gate se ensucia con archivos que el barrido no lee); frenos sobre **datos**, no sintaxis (`if_exists='replace'`, `--full-refresh`, SQL destructivo, notebooks con salidas) |
| [`elixir-phoenix.json`](elixir-phoenix.json) | servicio Phoenix (Elixir/OTP) | Gitea `#123` | el árbol de supervisión —la tolerancia a fallos del stack— entra en `invariants`, porque sacarle un hijo no rompe ningún test; `--warnings-as-errors` porque en Elixir un aviso ES un bug; `String.to_atom` prohibido (fuga que tira el nodo) |
| [`unity-game.json`](unity-game.json) | juego en Unity (C#) | Jira `GAME-412` | `protectedPaths` vale más que el resto junto: los `.meta` llevan el GUID con que las escenas referencian assets y reescribir uno vacía la escena sin que el diff muestre nada; una señal verifica que ningún asset viaje sin su `.meta`; los patrones frenan lo que asigna memoria en `Update()` |
| [`embedded-c.json`](embedded-c.json) | firmware C para microcontrolador (Zephyr) | Azure Boards `AB#1187` | el más estricto, y con razón: sin ctrl-Z en equipos de campo. `malloc`/`printf`/espera activa prohibidos, watchdog en `invariants`, una señal que falla si el binario no entra en la flash, y flashear en `bash.deny` porque toca hardware físico |
| [`legacy-brownfield.json`](legacy-brownfield.json) | repo heredado, sin tests y sin dueño | GitHub `#123` | **el más parecido a la realidad**: arranca con cuatro frenos, `patterns` con **una** regla (la que tiene cicatriz) y `forbiddenDeps` vacío a propósito. El gate arranca en lo que hoy sale verde —que compile— y crece con `/lesson`, un freno por incidente |
| [`monorepo.json`](monorepo.json) | workspace con varios paquetes | Azure Boards `AB#123` | el gate corre el workspace completo; `skipIfMissing` para clones parciales |
| [`infra-terraform.json`](infra-terraform.json) | repo de infraestructura | Gitea `#123` | el arnés se invierte: `bash.deny` es la mitad del valor (planear sí, aplicar no) |

La columna **Forja** está a propósito: seis gestores distintos con el mismo mecanismo. Ningún
script del arnés conoce ninguno — lo único que cambia es `tracker.issuePattern`. Ver
[trazabilidad.md](../docs/trazabilidad.md).

Los veinte archivos los verifica el gate (sección 8 del self-test): parsean, sus regex compilan,
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

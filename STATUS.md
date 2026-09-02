# STATUS — estado verificado

Lo imprime el hook `SessionStart`. Sirve para no releer el repo entero para contestar "¿esto anda?".
Se actualiza cuando cambia el veredicto, no en cada commit. **Sólo va lo verificado con un comando**;
lo que se supone va en "deuda conocida".

- **Fecha del último gate completo:** 2026-09-02
- **Rama:** `main`
- **Veredicto:** VERDE (`npm run gate`)

## Señales

| Señal | Comando | Resultado |
|---|---|---|
| Self-test del arnés | `node scripts/harness-selftest.mjs` | verde — 140 casos: 10 hooks declarados y parseados, 64 regex del config compilan, 16 rutas resuelven, los frenos probados con muestras derivadas del propio config, 8 reglas del lint muerden, 6 casos de ruteo, 8 perfiles de stack instalados en repos temporales |
| Los frenos no muerden de más | incluido en el self-test | verde — un archivo normal pasa `protected-paths`, `git status` pasa `bash-guard`, el router se calla en lo trivial |
| Link-check de docs | `node scripts/docs-linkcheck.mjs` | verde — enlaces y rutas citadas medidos contra `git ls-files`, y **sólo** en archivos que git no ignora (el mismo criterio en las dos direcciones) (`docs.proseRoots` acota qué raíces) · la prosa de hooks y scripts (`proseInSource`) · que los documentos de `mentionSignals` nombren las 4 señales · y que la página enlace los **15** documentos (`mustLinkAll`) |
| Lint de convenciones | `node scripts/repo-lint.mjs` | verde — PUREZA (hooks sin lanzar procesos, 2 excepciones declaradas; sintaxis de import agnóstica: `import`, `using`, `use`, `#include`) · EVENTOS (`singleSource`) · INVARIANTE (contrato de exit codes de `harness.mjs`) · DEPS · TODO · CONSOLE · GRIDLI · ONLY · INCIDENTE · PERFIL (ningún perfil de stack lleva reglas ajenas) |
| Reglas activas | `node scripts/repo-lint.mjs --rules` | verde — 1 capa de pureza · 5 deps vetadas · 1 registro · 1 archivo con invariantes · 3 patrones · registro de incidentes · 8 perfiles de stack |
| Los scripts del arnés parsean | incluido en el self-test | verde — `node --check` sobre los 5 `.mjs` de `scripts/`; el instalador viajó roto dos releases porque sólo se verificaban los hooks |
| No se actúa sobre una pregunta | incluido en el self-test | verde — 8 pedidos reales por las dos direcciones (interrogación, pregunta sin signos, verbo en pasado, reporte sin imperativo · imperativo, orden corta, pedido directo) + escribir fuera del repo sigue permitido |
| El trabajo entra por PR | incluido en el self-test | verde — `pre-push` frena el empujón directo a `main` y a `master`, y deja pasar una rama de feature. La protección del lado del servidor **no la verifica el gate** (necesita red): se activa a mano |
| El trabajo queda registrado | incluido en el self-test | verde — 6 casos de `.githooks/commit-msg` en un repo git temporal, derivados del config: código sin referencia, con referencia, con la fuga y su motivo, la fuga pelada, extensión ignorada, y un merge |
| Artefactos donde se declaró | `node scripts/artifacts-check.mjs` | verde — sin `specs/` porque el trabajo vive en el gestor; el cebo del self-test lo pone en rojo |
| Banco de perfiles (stacks reales) | `node scripts/harness-bench.mjs` | verde — **96 comprobaciones sobre 8 repos de juguete** (.NET, Maven, Gradle, Python, Go, Rust, Node, front) con archivos reales del lenguaje: detección del stack, DEPS contra el manifiesto real, PUREZA contra el import real, `tests.filePattern` contra el layout real, los hooks sobre archivos reales, `commit-msg` y que el arnés instalado no apunte a la nada. Cazó **dos** bugs en su primera corrida. 15s (`fastSkip`); con `--con-gate` corre además el gate de cada repo portado (~75s) y eso vive en CI |
| Gate completo | `npm run gate` | verde — 5 señales, ninguna omitida. ~44s (antes ~10s: el banco cuesta 15s y el resto es el self-test instalando los 8 perfiles). En modo `fast` el banco se omite |
| Instalador (dry-run) | `node scripts/harness-init.mjs <repo>` | verde — 38 archivos a copiar (detecta el stack y aplica su perfil), no sobreescribe, imprime los pasos que ninguna herramienta puede hacer sola |
| Ningún freno viaja muerto | incluido en el self-test | verde — la tabla `install.activators` cruza los frenos que el instalador copia contra la clave del config que los activa. Cazó tres frenos que viajaban inertes (`ask-first`, `action-guard`, `pre-push`: la plantilla no traía `askFirst` ni `branches`) |
| Configs de ejemplo publicadas | incluido en el self-test (sección 8) | verde — los **7** ejemplos (`node-typescript`, `python`, `go`, `monorepo`, `infra-terraform`, `dotnet`, `jvm-spring`) parsean, sus regex compilan, cada señal declara su `why`, y un manifiesto que no es clave-valor trae su `matcher`. Un cebo con las tres fallas da 3 hallazgos |
| Portado a un stack que no es Node | incluido en el self-test (sección 8) | verde — los **8** perfiles (`node`, `front`, `dotnet`, `jvm-maven`, `jvm-gradle`, `python`, `go`, `rust`) se instalan en un repo git temporal: el dry-run no escribe, el config generado trae las extensiones del perfil y `gate.signals` queda intacto |
| Qué cuenta como código sale del config | incluido en el self-test | verde — tres frentes: `post-edit-check` marca el gate por cada extensión de `gate.codeExtensions` y **no** por una no declarada; la rama **por default** (`codeExtensions: []`, la que usa todo repo portado sin perfil) se ejercita en un repo temporal con `.cs`, `.java` y `.py`; y las dos listas de extensiones no pueden divergir (`gate.codeExtensions` ⊆ barrido del lint). El default agnóstico es **uno** y vive en `harness.mjs` |
| Los frenos por ruta funcionan con symlinks | incluido en el self-test | verde — **cuatro** casos, uno por variante: el repo entero bajo un symlink (`/tmp` en macOS), un `node_modules/<dep>` symlinkeado hacia afuera (pnpm, workspaces), la ruta directa equivalente, y un **alias interno** de una ruta protegida. Lo que se normaliza es la raíz, no el archivo, y las reglas de negación evalúan todos los nombres del archivo |
| Las clases de regla del lint tienen todas su caso | incluido en el self-test | verde — PUREZA (una por plantilla de import) · DEPS (muerde y **no** de más) · ONLY · FUENTEUNICA · INVARIANTE (no tenía ninguno: se prueba con un config temporal vía `--config`) · PATRON · INCIDENTE · PERFIL (cebo por clave prohibida, por clave obligatoria, `dir` inexistente y `dir` vacío) |
| Ninguna extensión queda sin barrer | incluido en el self-test | verde — se compara contra la lista **efectiva** (`lint.sourceExtensions` o el default agnóstico), en el repo, en los 8 perfiles y en los 7 ejemplos publicados. Cazó un `.csproj` real en `examples/dotnet.json`: ensuciaba el gate y el barrido no lo leía |

Pre-commit instalado: sí (`core.hooksPath=.githooks`). CI corre **el mismo** `npm run gate`.

## Deuda conocida

- **`sampleFromPattern` no reduce todos los regex a un ejemplo.** Los patrones con lookbehind,
  backreferences o clases anidadas se reportan **omitidos** (nunca pasados) y hay que probarlos a
  mano. Mecanismo candidato: un campo `sample` opcional por regla, para que el autor dé el ejemplo
  cuando el generador no puede.
- **El clasificador de intención es angosto a propósito.** `ask-first` caza interrogación
  explícita, preguntas sin signos que arrancan con interrogativo, verbos en pasado y reportes que
  empiezan con «hay/existe/falta». **No** caza un pedido informativo redactado como afirmación
  neutra («me interesa entender X»): ahí el agente puede volver a actuar sin que se lo pidan.
  Ensancharlo bloquearía instrucciones legítimas (ley 4), así que el hueco queda declarado.
- **El freno de registro pide *un* registro, no el *correcto*.** `commit-msg` exige una referencia
  o una declaración firmada, pero que una feature vaya con ítem madre y tareas en vez de un bug
  suelto sigue siendo criterio del agente y del `reviewer`. Mecanismo candidato: un check del
  `reviewer` que marque diffs con archivos nuevos en la superficie pública sin ítem de tipo feature.
- **Un `issuePattern` demasiado ancho pasa el self-test.** La muestra se deriva del propio patrón,
  así que un patrón que caza de más también caza su muestra. Se prueba a mano con un mensaje real
  del equipo. Está escrito como gotcha.
- **El ruteo de trabajo informa, no bloquea.** Nada impide entregar una feature grande sin declarar
  la ruta salvo el criterio del agente y el `reviewer`: la intención no es verificable por máquina.
- **`bash.deny` es un guardarraíl, no un sandbox.** Sube el costo del error accidental; un agente
  puede reformular el comando. Para aislamiento real hacen falta contenedores o permisos del SO.
- **El lint es regex sobre texto, sin AST.** Un patrón dentro de un comentario o de un string cuenta
  igual. Cuando eso moleste de verdad, la señal correcta es el linter del stack, no complicar este
  script.
- **El instalador se prueba en CI, pero no el gate del repo portado.** La sección 8 del self-test
  instala cada perfil en un repo temporal y verifica el config generado; lo que **nadie** verifica
  es que el gate de ese repo quede verde, porque para eso hacen falta las señales reales del
  equipo. Mecanismo candidato: un repo de juguete por perfil con su gate mínimo.
- **Los perfiles se prueban contra repos de juguete, no contra repos de producción.** El banco
  (`node scripts/harness-bench.mjs`) instala el arnés en un repo real de cada stack con archivos
  reales del lenguaje, y ahí ya cazó dos bugs. Lo que sigue sin cubrir es la escala: un monorepo
  Gradle con 40 módulos, un `.sln` con proyectos en rutas raras, un `pyproject` con `uv`. Se paga
  la primera vez que alguien porte a uno de esos, y ahí entra `/lesson`.
- **Ninguna señal del stack se ejecuta en el banco.** El banco no corre `dotnet build` ni
  `mvn verify`: no hay SDKs instalados y tenerlos volvería el gate irreproducible. Lo que se
  verifica es el arnés sobre archivos reales, no que el stack compile.
- **La landing page (`docs/index.html`): dos tercios de deuda cerrada.** Que nombre **todas** las señales del
  gate ya lo verifica `docs-linkcheck` (`docs.mentionSignals`), porque envejeció en una sola sesión.
  Una clase de rotura visual sí tiene freno desde hoy: la regla `GRIDLI` (un `li` como contenedor
  grid/flex parte el texto en una palabra por línea, y sólo se ve al publicar). Lo que sigue sin
  cubrir es el resto del aspecto y que los transcripts sean salida real de hoy: eso no lo juzga
  ninguna máquina y se revisa a ojo cuando cambia. **Mirá la página publicada después de tocarla.**
  Lo que sí quedó cubierto: que nombre las señales del gate (`mentionSignals`) y que enlace todos
  los documentos (`mustLinkAll`).
- **Sin `postCommit` ni `graph` configurados.** Las dos claves existen y están documentadas, pero
  este repo no las usa, así que su comportamiento no está cubierto por ninguna señal de acá.

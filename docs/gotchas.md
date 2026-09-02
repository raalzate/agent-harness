# Gotchas — lo que ya nos costó horas

Formato fijo: **síntoma observable → causa raíz → regla → mecanismo que la hace fallar**.
Se escribe en el momento en que se paga, no "cuando haya tiempo" (`/lesson <incidente>`).

La línea `Mecanismo:` es obligatoria y la exige el lint (regla INCIDENTE): sin ella la entrada es
prosa que se va a volver a pagar. Si no hay mecanismo, **se escribe así**, con el motivo — un hueco
declarado se puede cerrar; uno tácito, no.

Estos son incidentes reales de construir y portar este arnés. Sirven de ejemplo del formato y,
varios, de advertencia concreta para quien lo instale en su repo.

---

### GOTCHA: escribir la config del arnés dispara el propio arnés

Síntoma: crear `.claude/harness.config.json` con un heredoc del shell muere con
         `COMANDO BLOQUEADO … Motivo: saltarse los hooks de verificación está prohibido`.
Causa:   el archivo de config **contiene** los patrones que él mismo prohíbe. El guard mira la
         línea de comandos completa, y un heredoc mete el contenido del archivo dentro de esa línea.
Regla:   los archivos de config del arnés se escriben con la herramienta de edición del agente,
         nunca por heredoc del shell. Y los patrones sensibles se escriben con una clase de un
         carácter (`--no-ver[i]fy`) para que el archivo no se cace a sí mismo al ser leído.
Mecanismo: el propio `bash-guard.mjs` — el incidente ES el mecanismo funcionando. Queda escrito
         acá porque el mensaje de bloqueo no explica *por qué* apareció al escribir la config.

### GOTCHA: el hook instalado que nunca corre

Síntoma: una herramienta dice "hook instalado", el archivo existe en `.git/hooks/`, y no se ejecuta
         nunca. Ninguna señal falla: simplemente no pasa nada.
Causa:   el repo setea `core.hooksPath=.githooks`, así que git **ignora** `.git/hooks/` por
         completo — que es exactamente donde escriben los instaladores automáticos.
Regla:   todo hook de git vive en `.githooks/` y se versiona. Después de instalar cualquier
         herramienta que "agregue un hook", verificar `git config core.hooksPath`.
Mecanismo: el hook `SessionStart` avisa en cada sesión si `core.hooksPath` no vale `.githooks`.

### GOTCHA: el freno que bloquea de más termina desactivado a mano

Síntoma: alguien comenta una regla del config, o el equipo empieza a pedir excepciones para trabajo
         legítimo. Semanas después el arnés entero tiene fama de estorbo.
Causa:   se probó que la regla **muerde** y no que **no muerde de más**. Un patrón demasiado ancho
         —por ejemplo `console\.log\(` sin excluir los tests— bloquea trabajo correcto.
Regla:   toda regla nueva se valida con dos comandos, no uno: el self-test (¿muerde?) y el lint
         completo del repo (¿el repo sigue pasando?).
Mecanismo: el self-test incluye casos de "deja pasar lo inocente" (un archivo normal, un
         `git status`), y el gate corre el lint sobre el repo entero.

### GOTCHA: el índice derivado que contesta con datos viejos

Síntoma: el agente responde con confianza sobre código que ya se cambió; nada falla.
Causa:   un derivado que el agente consulta (grafo del repo, índice de símbolos, caché) quedó atrás
         del HEAD y **igual contesta**: con menos verdad y sin avisar. Es la peor clase de error
         porque no tiene síntoma.
Regla:   todo derivado que el agente consulte necesita dos señales: **frescura** (¿para qué commit
         está construido?) y **tamaño** (¿se encogió respecto de su línea base?). La frescura se
         mide sellando el sha indexado y comparándolo contra HEAD, no por reloj: medir por tiempo
         da falsos rojos.
Mecanismo: en este repo, ninguno ejecutable — no hay derivados. Queda escrito porque es la trampa
         que más cuesta al portar el arnés a un repo grande, y el config lo prevé (`postCommit`,
         `graph`).

### GOTCHA: el arnés escribiendo temporales dentro del árbol de fuentes

Síntoma: con el servidor de desarrollo vivo, el build muere con `ENOENT` sobre un archivo que nadie
         escribió; el error aparece y desaparece.
Causa:   el self-test creaba archivos temporales dentro del directorio de fuentes para probar los
         frenos del lint. El watcher los veía aparecer y desaparecer a mitad de una compilación.
Regla:   el arnés **no escribe en el árbol de fuentes**. Para probar un freno del lint se le pasa el
         contenido por stdin y la ruta sólo elige las reglas:
         `node scripts/repo-lint.mjs --file <ruta virtual> --stdin`.
Mecanismo: el modo `--stdin` de `scripts/repo-lint.mjs`, y un caso del self-test que falla si
         quedaron archivos temporales en la raíz del repo.

### GOTCHA: los hooks citaban tres documentos que no existían

Síntoma: el hook imprimía «Criterio completo: `docs/harness/sdd.md`» en cada prompt <!-- linkcheck:ignora -->, y ese archivo
         no existe en este repo. Otros dos punteros igual de muertos. Gate verde todo el tiempo.
Causa:   dos capas. Los hooks se copiaron con la prosa de OTRA estructura de carpetas
         (`docs/harness/`, `docs/architecture/`) <!-- linkcheck:ignora -->, y el link-check sólo recorría `*.md`: lo que un
         hook le IMPRIME al agente es memoria igual que un markdown, pero vive en un `.mjs`.
Regla:   un hook no cablea rutas de documentación: el documento que cita sale del config
         (`sdd.doc`, `docs.reuseCatalog`) y se cita sólo si existe. Los docs del arnés **no
         viajan** con la instalación, así que cablearlos garantiza un puntero muerto en el destino.
Mecanismo: `docs.proseInSource` — el link-check también revisa la prosa de `.claude/hooks`,
         `.githooks` y `scripts`. Al encenderlo cazó los tres punteros y cinco ejemplos mal
         escritos en los propios scripts.

### GOTCHA: el falso rojo con una ruta que nadie escribió

Síntoma: el link-check reportaba `docs/mi` — un prefijo que no aparece en ningún documento. <!-- linkcheck:ignora -->
Causa:   la ruta real tenía espacios (un PDF exportado de diseño) y el barrido de rutas en prosa la
         cortaba en el primer espacio.
Regla:   una ruta citada entre backticks se evalúa **completa**, espacios incluidos, y su prefijo
         truncado no se vuelve a reportar.
Mecanismo: el paso de backticks en `scripts/docs-linkcheck.mjs`, previo al barrido general. Un rojo
         mentiroso es peor que el silencio: entrena al equipo a ignorar la señal.

### GOTCHA: el self-test daba falso rojo con hooks que no eran «node archivo»

Síntoma: `✗ el archivo del hook no existe` sobre dos hooks que existían y funcionaban: un binario
         externo y uno declarado con `$CLAUDE_PROJECT_DIR` entre comillas.
Causa:   el analizador era `/node\\s+(\\S+)/`: asumía que todo hook es `node <archivo>`, y `(\\S+)`
         se tragaba la comilla y la variable.
Regla:   se normaliza antes de analizar (comillas, `$CLAUDE_PROJECT_DIR`), y de un ejecutable
         externo se afirma **sólo que existe** — no se le puede pedir `node --check`.
Mecanismo: paso 1c del self-test, con cinco formas reales de declarar un hook.

### GOTCHA: el instalador viajó roto en dos releases

Síntoma: `node scripts/harness-init.mjs <repo>` moría con `SyntaxError: missing ) after argument
         list`. El gate estaba verde y el archivo llevaba dos releases publicado así.
Causa:   un texto entre backticks —\`sin-issue:\`— se agregó DENTRO de un template literal, y
         cerró la cadena a mitad de camino. Y el gate no lo veía por dos motivos que se sumaron:
         el self-test verificaba la sintaxis de los **hooks** pero no la de los **scripts**, y el
         instalador no corre en el gate (lo corre quien porta el arnés, una vez).
Regla:   todo script del arnés parsea, se ejecute o no en el gate. Y al insertar texto dentro de un
         template literal, los backticks van escapados.
Mecanismo: paso 1b del self-test — `node --check` sobre cada `.mjs` de `scripts/`. Probado
         rompiendo el instalador a propósito: el self-test se pone rojo y nombra el archivo.

### GOTCHA: el patrón que no casaba porque la palabra terminaba en acento

Síntoma: un clasificador con el patrón `^\\s*(qu[eé]|c[oó]mo)\\b` no reconocía «qué hace esto»
         ni «cómo se instala». El regex se veía correcto y el freno no mordía.
Causa:   `\\b` se define sobre `\\w`, que es `[A-Za-z0-9_]`. Después de «qué» hay una «é»
         —no es carácter de palabra— y el espacio tampoco: entre dos no-palabra **no hay límite**,
         así que `\\b` falla. Con «que» sin tilde el mismo patrón funciona, que es lo que vuelve
         al bug tan difícil de ver.
Regla:   en texto en español, un patrón no termina en `\\b` después de una vocal acentuada: se
         cierra con un lookahead explícito, `(?=\\s|$|[,:])`.
Mecanismo: los ocho casos de `ask-first` en el self-test están escritos **con acentos reales** y en
         las dos direcciones. Un patrón que vuelva a `\\b` los pone en rojo.

### GOTCHA: una palabra por línea en la lista publicada

Síntoma: la lista de leyes salió publicada con el texto de cada ítem en columna —una palabra por
         renglón— mientras el título del ítem ocupaba el ancho completo. En el editor el HTML se
         veía bien.
Causa:   el `<li>` era `display: grid` con dos columnas (marcador · contenido) y su contenido
         mezclaba un `<b>` con texto suelto. En un contenedor grid, un nodo de texto suelto se
         convierte en un **ítem anónimo** y ocupa la celda siguiente: la del marcador, de 1.9rem.
Regla:   ningún `li` es contenedor grid o flex. El marcador va en un `::before` absoluto y el
         contenido fluye en línea, con `padding-left` para la sangría.
Mecanismo: regla `GRIDLI` del lint sobre los `.html` (la construcción se eliminó de toda la
         página antes de instalarla, así que no bloquea nada legítimo), con su caso en el
         self-test. El bug obligó además a arreglar el generador de muestras: validaba los
         metacaracteres escapados como si fueran sintaxis y reportaba **omitido** cualquier patrón
         con `\{` — medio CSS.

### GOTCHA: la página que mostraba el gate de ayer

Síntoma: entró una señal nueva al gate y la página del repo siguió mostrando el transcript anterior,
         con tres señales donde ya había cuatro. Nada falló: un documento que enumera de menos no
         rompe nada, sólo miente.
Causa:   el link-check verificaba que los punteros apunten a algo, no que las **listas** estén
         completas. Y la deuda estaba declarada («ninguna máquina juzga si una página se ve bien»),
         lo que tapó que sí hay una parte verificable: qué señales nombra.
Regla:   todo documento que enumere las señales del gate se declara en `docs.mentionSignals`, y si
         falta una, es rojo. Verifica hacia un solo lado a propósito: que **falte** una señal es
         mentira; que sobre texto, no.
Mecanismo: `node scripts/docs-linkcheck.mjs` en el gate, con su caso en el self-test (un config
         cebo que declara un documento que no las nombra). El cebo vive en un temporal: el arnés no
         escribe en el árbol de fuentes.
         **Segunda vuelta:** el mismo agujero tenía otra cara —la página no enlazaba nueve de los
         quince documentos, así que para quien llegaba de afuera no existían—. Se cierra con
         `docs.mustLinkAll`: el índice enlaza TODO lo que hay bajo `from`, y lo que se deja afuera
         se escribe en `except` en vez de olvidarse.

### GOTCHA: el patrón de referencia que cazaba «UTF-8»

Síntoma: el freno de registro deja pasar commits sin ítem de trabajo, y el self-test está verde.
Causa:   `tracker.issuePattern` quedó como `\\b[A-Z]{2,}-[0-9]+\\b` para un equipo con Jira. Ese
         patrón caza `PROJ-123`… y también `UTF-8`, `SHA-256`, `HTTP-2` e `ISO-8601`: cualquier
         commit que mencione un estándar «tiene referencia».
Regla:   los patrones de referencia anclan los **prefijos reales** de los proyectos
         (`\\b(PROJ|OPS|INFRA)-[0-9]+\\b`), y se prueban con un mensaje de commit de verdad, no
         sólo con el self-test.
Mecanismo: ninguno ejecutable, y el motivo importa: el self-test **deriva la muestra del propio
         patrón**, así que un patrón que caza de más también caza su muestra y sale verde. Es el
         límite estructural de generar casos desde el config (`docs/decisions/0003-selftest-generado.md`).
         Queda como advertencia en `docs/trazabilidad.md` y en el paso 4 de `docs/portar.md`.

### GOTCHA: el gate verde que no probaba nada

Síntoma: el gate sale verde en un repo recién portado, en dos segundos, y nadie sospecha.
Causa:   `gate.signals` quedó con las tres señales del arnés y ninguna del proyecto. El gate
         verificaba que el arnés funciona, no que el software funciona.
Regla:   un gate recién instalado se prueba al revés: **rompé algo a propósito** (un tipo, un test)
         y confirmá que el gate se pone rojo. Un gate que nunca falló no es un gate, es una
         esperanza.
Mecanismo: `scripts/gate.sh` es rojo si NINGUNA señal llegó a correr (contador `RAN`) — el caso que
         disparó esto: las señales se pasaban al bucle separadas por TAB, `read` con IFS de espacios
         en blanco colapsa delimitadores consecutivos, el campo vacío de `skipIfMissing` corría los
         demás un lugar y las tres señales salían "omitidas"… con veredicto VERDE. Ahora el
         separador es US (0x1f). Que las señales sean las CORRECTAS sigue sin poder verificarlo
         ninguna máquina: es el paso 1 de `docs/portar.md` y lo mira el `reviewer`.

### GOTCHA: la regla de lint que cazaba una palabra del idioma

Síntoma: el lint marcaba `[TODO] un TODO sin issue es deuda invisible` sobre un comentario que
         decía «**TODO** lo específico del repo vive en el config».
Causa:   el patrón era `\b(TODO|FIXME|XXX)\b` y en español «todo» es una palabra corriente. El
         freno mordía trabajo legítimo — que es exactamente cómo un arnés se termina desactivando.
Regla:   un marcador de deuda se reconoce por su **forma**, no por la palabra: exige `:` o `(`
         inmediatamente después (`TODO:` o `TODO(#12)`). Y toda regla nueva se prueba con dos
         comandos: ¿muerde? y ¿el repo sigue pasando?
Mecanismo: la regla `TODO` del config con el patrón `\b(TODO|FIXME|XXX)(:|\((?!#))`, el caso del
         self-test que la ejercita y `node scripts/repo-lint.mjs` sobre el repo entero en el gate.

### GOTCHA: el arnés agnóstico que sólo mordía en JS

Síntoma: alguien preguntó qué pasa con un repo de .NET o de Java. La respuesta corta era «nada,
         es agnóstico»; la auditoría encontró cuatro lugares donde no lo era, y el peor no fallaba
         nunca: en un repo de .NET, editar un `.cs` **no** marcaba el gate ni corría el lint del
         archivo. Verde todo el tiempo, freno de mayor retorno muerto.
Causa:   la arquitectura era agnóstica pero cuatro literales de stack se habían filtrado al código:
         las extensiones de código cableadas en `post-edit-check.mjs`, la sintaxis de import de la
         regla PUREZA sin `using` de C#, el matcher de DEPS que sólo entendía manifiestos
         clave-valor (un `.csproj` salía verde con la dependencia prohibida presente), y avisos que
         nombraban `npm run …` en un repo donde no existe. Ninguno tenía un caso de self-test que
         los ejercitara fuera de JS: un freno cuya prueba de vida usa el único stack donde funciona
         no es una prueba de vida.
Regla:   toda lista de literales de un lenguaje es una clave del config con default agnóstico
         (P4), y su caso del self-test se **deriva de esa clave** — nunca de un ejemplo escrito a
         mano en el stack del repo que la escribió. Lo que un stack necesita para arrancar viaja en
         un perfil (`plantillas/perfiles/`), y un perfil lleva hechos del lenguaje, no reglas de un
         equipo (P14).
Mecanismo: `gate.codeExtensions`, `lint.sourceExtensions`, `purityImportSyntax`,
         `forbiddenDeps.matcher`, `gate.installHooksCommand` y `status.reminder` en el config, con
         **un solo** default agnóstico (`DEFAULT_CODE_EXTENSIONS` en `.claude/hooks/harness.mjs`:
         dos listas ya habían divergido en `.pyi`, que ensuciaba el gate mientras el barrido del
         lint no lo leía). Casos del self-test: 3e-quater (una por extensión declarada),
         3e-quinquies (la rama por DEFAULT, en un repo temporal: es la que usa todo repo portado
         sin perfil), 3e-sexies (las dos listas no divergen), 4b-bis (una por plantilla de import),
         4g (DEPS por stdin), 4h (PERFIL con un cebo por clave prohibida y otro por clave
         obligatoria, más `profiles.dir` inexistente y vacío). Más la regla `PERFIL` de
         `repo-lint.mjs` y la sección 8, que instala **cada** perfil en un repo temporal y corre
         `repo-lint.mjs` **del destino** —no el de acá, que ignora el cwd y hacía pasar la
         aserción con un config generado vacío.

### GOTCHA: los frenos por ruta se apagaban bajo un symlink

Síntoma: en un repo temporal montado bajo `/tmp` (que en macOS es un symlink a `/private/tmp`),
         editar `src/Servicio.cs` no marcaba el gate, no corría el lint del archivo y no
         disparaba las rutas protegidas. Ningún error: exit 0 y silencio.
Causa:   `REPO_ROOT` sale de `import.meta.url` y llega ya resuelto (`/private/var/...`), mientras
         que el `cwd` del payload llega como lo escribió quien invocó (`/var/...`). `path.relative`
         entre los dos devuelve una ruta con `../../..`, y todos los frenos que preguntan «¿esto
         está dentro del repo?» contestan que no.
Regla:   lo que se normaliza es la RAÍZ, no el archivo: se busca el prefijo de la ruta cuyo
         `realpath` sea la raíz del repo, y lo que sobra es la ruta relativa. Resolver el archivo
         entero arregla una dirección y rompe la otra —un `node_modules/<dep>` symlinkeado (pnpm,
         workspaces) apunta afuera del repo y el freno se apaga **hacia abajo**—, y ésa es la
         dirección que nadie nota. Un freno por ruta se decide siempre hacia el lado seguro: si la
         ruta pertenece al repo por alguna de las dos formas, las reglas se aplican. Y hay una
         tercera variante: un alias DENTRO del repo (`alias/ → src/secreto/`) no es una ruta
         nueva, es **otro nombre de una ruta que ya tiene dueño**. Para las reglas de negación se
         evalúan TODOS los nombres y basta que uno case: prohibir por un nombre mientras el otro
         pasa es no prohibir.
Mecanismo: `relativaAlRepo()` y `targetPaths()` en `.claude/hooks/harness.mjs` —`targetPath()`
         devuelve UNA ruta para decidir «¿esto es código?»; `targetPaths()` devuelve todas las que
         el archivo tiene dentro del repo, y es la que usa `protected-paths`— más **cuatro** casos
         del self-test, uno por variante: el repo entero bajo `/tmp` (3e-quinquies), un
         `node_modules/<dep>` symlinkeado afuera, la ruta directa equivalente, y un alias interno
         de una ruta protegida (3e-septies). Con un solo caso el arreglo de una dirección abre la
         otra: pasó dos veces en esta misma sesión, y las dos las cazó el caso de la dirección
         contraria.

### GOTCHA: el self-test daba FALSO ROJO en todo repo que no fuera JS

Síntoma: en un repo .NET portado, el self-test reportaba `✗ lint PUREZA protege src/Domain` — una
         regla que, probada a mano contra el `Order.cs` real, **funcionaba perfectamente**.
Causa:   el caso 4b armaba su muestra cableada en JS: `import x from "mod"` en un archivo
         `ejemplo-selftest.mjs`. La regla estaba configurada con la sintaxis del stack
         (`using X;`), así que la muestra no la cazaba. El caso medía su propia suposición, no la
         regla. Y el caso hermano (4b-bis) sólo corría con `purityImportSyntax` **declarado**, así
         que en la mayoría de los repos no corría ninguno de los dos bien.
Regla:   la muestra de un caso se deriva de la **configuración efectiva** —la declarada o el
         default compartido—, nunca de un ejemplo escrito a mano en el stack de quien escribió el
         caso. Un falso rojo es peor que ningún caso: enseña a ignorar la sección entera, y con
         ella los casos que sí servían.
Mecanismo: `DEFAULT_IMPORT_SYNTAX` + `importSyntax()` en `.claude/hooks/harness.mjs` (un solo
         default, consumido por `repo-lint.mjs` y por el self-test), el caso 4b derivando su
         muestra de esa lista y su extensión de `lint.sourceExtensions`, y la señal
         **banco de perfiles** (`node scripts/harness-bench.mjs`) en el gate: instala el arnés en
         un repo real de cada stack y ahí el falso rojo aparece. Fue el banco el que lo encontró.

### GOTCHA: el arnés recién instalado apuntaba a la nada

Síntoma: `docs-linkcheck` del repo portado salía **rojo el primer día**, antes de que el equipo
         escribiera una sola línea: cuatro hallazgos de «ruta citada», del subagente `reviewer`,
         del comando `/harness-audit` y de la constitución, hacia documentos del arnés que en el
         repo destino no existían.
Causa:   los subagentes, los comandos y las plantillas citan documentos del arnés que el
         instalador **no copiaba**. El propio instalador violaba P10, y peor: el rojo era
         indistinguible del rojo esperado por los placeholders, así que se lee como «ya sé, es el
         mapa» y nadie lo mira.
Regla:   lo que el arnés instalado cita, viaja con el arnés — o no se cita. Y el rojo de un repo
         recién portado tiene que ser **sólo** el de los placeholders del config: cualquier otro
         rojo el primer día entrena al equipo a ignorar la señal.
Mecanismo: `docs/sdd.md`, `docs/buenas-practicas.md` y `docs/trazabilidad.md` en la lista de
         copia del instalador; `plantillas/arnes.md`, `plantillas/ci.yml` y `plantillas/ADR.md`
         como plantillas del destino (el documento del arnés, el CI que corre el mismo gate, y
         la plantilla de ADR que además crea el directorio de decisiones); y la sección 8 del
         self-test, que corre
         `docs-linkcheck` **dentro** de cada repo portado y falla si sale rojo.

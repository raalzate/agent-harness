# STATUS — estado verificado

Lo imprime el hook `SessionStart`. Sirve para no releer el repo entero para contestar "¿esto anda?".
Se actualiza cuando cambia el veredicto, no en cada commit. **Sólo va lo verificado con un comando**;
lo que se supone va en "deuda conocida".

- **Fecha del último gate completo:** 2026-08-21
- **Rama:** `main`
- **Veredicto:** VERDE (`npm run gate`)

## Señales

| Señal | Comando | Resultado |
|---|---|---|
| Self-test del arnés | `node scripts/harness-selftest.mjs` | verde — 9 hooks declarados y parseados, 58 regex del config compilan, 27 rutas resuelven, 22 frenos probados con muestras derivadas del propio config, 5 reglas del lint muerden, 5 casos de ruteo |
| Los frenos no muerden de más | incluido en el self-test | verde — un archivo normal pasa `protected-paths`, `git status` pasa `bash-guard`, el router se calla en lo trivial |
| Link-check de docs | `node scripts/docs-linkcheck.mjs` | verde — enlaces y rutas citadas medidos contra `git ls-files` (`docs.proseRoots` acota qué raíces) · la prosa de hooks y scripts (`proseInSource`) · que los documentos de `mentionSignals` nombren las 4 señales · y que la página enlace los **15** documentos (`mustLinkAll`) |
| Lint de convenciones | `node scripts/repo-lint.mjs` | verde — PUREZA (hooks sin lanzar procesos, 2 excepciones declaradas) · EVENTOS (`singleSource`) · INVARIANTE (contrato de exit codes de `harness.mjs`) · TODO · CONSOLE · ONLY · INCIDENTE |
| Reglas activas | `node scripts/repo-lint.mjs --rules` | verde — 1 capa de pureza · 5 deps vetadas · 1 registro · 1 archivo con invariantes · 2 patrones · registro de incidentes |
| Los scripts del arnés parsean | incluido en el self-test | verde — `node --check` sobre los 5 `.mjs` de `scripts/`; el instalador viajó roto dos releases porque sólo se verificaban los hooks |
| No se actúa sobre una pregunta | incluido en el self-test | verde — 8 pedidos reales por las dos direcciones (interrogación, pregunta sin signos, verbo en pasado, reporte sin imperativo · imperativo, orden corta, pedido directo) + escribir fuera del repo sigue permitido |
| El trabajo entra por PR | incluido en el self-test | verde — `pre-push` frena el empujón directo a `main` y a `master`, y deja pasar una rama de feature. La protección del lado del servidor **no la verifica el gate** (necesita red): se activa a mano |
| El trabajo queda registrado | incluido en el self-test | verde — 6 casos de `.githooks/commit-msg` en un repo git temporal, derivados del config: código sin referencia, con referencia, con la fuga y su motivo, la fuga pelada, extensión ignorada, y un merge |
| Artefactos donde se declaró | `node scripts/artifacts-check.mjs` | verde — sin `specs/` porque el trabajo vive en el gestor; el cebo del self-test lo pone en rojo |
| Gate completo | `npm run gate` | verde — 4 señales, ninguna omitida |
| Instalador (dry-run) | `node scripts/harness-init.mjs <repo>` | verde — 23 archivos a copiar, no sobreescribe, imprime los 6 pasos que ninguna herramienta puede hacer sola |

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
- **El instalador no se prueba end-to-end en CI.** Se verifica en dry-run a mano; nada garantiza que
  un repo recién portado quede verde. Mecanismo candidato: un job de CI que instale el arnés en un
  repo de juguete y corra su gate.
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

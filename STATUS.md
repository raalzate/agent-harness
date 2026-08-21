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
| Link-check de docs | `node scripts/docs-linkcheck.mjs` | verde — enlaces y rutas citadas medidos contra `git ls-files`, con `docs.proseRoots` acotando qué raíces se verifican |
| Lint de convenciones | `node scripts/repo-lint.mjs` | verde — PUREZA (hooks sin lanzar procesos, 2 excepciones declaradas) · EVENTOS (`singleSource`) · INVARIANTE (contrato de exit codes de `harness.mjs`) · TODO · CONSOLE · ONLY · INCIDENTE |
| Reglas activas | `node scripts/repo-lint.mjs --rules` | verde — 1 capa de pureza · 5 deps vetadas · 1 registro · 1 archivo con invariantes · 2 patrones · registro de incidentes |
| Gate completo | `npm run gate` | verde — 3 señales, ninguna omitida |
| Instalador (dry-run) | `node scripts/harness-init.mjs <repo>` | verde — 23 archivos a copiar, no sobreescribe, imprime los 6 pasos que ninguna herramienta puede hacer sola |

Pre-commit instalado: sí (`core.hooksPath=.githooks`). CI corre **el mismo** `npm run gate`.

## Deuda conocida

- **`sampleFromPattern` no reduce todos los regex a un ejemplo.** Los patrones con lookbehind,
  backreferences o clases anidadas se reportan **omitidos** (nunca pasados) y hay que probarlos a
  mano. Mecanismo candidato: un campo `sample` opcional por regla, para que el autor dé el ejemplo
  cuando el generador no puede.
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
- **Sin `postCommit` ni `graph` configurados.** Las dos claves existen y están documentadas, pero
  este repo no las usa, así que su comportamiento no está cubierto por ninguna señal de acá.

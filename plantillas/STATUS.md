# STATUS — estado verificado

Lo imprime el hook `SessionStart`. Sirve para no releer el repo entero para responder
"¿esto anda?". Se actualiza cuando cambia el veredicto, no en cada commit. **Sólo va lo verificado
con un comando**; lo que se supone va en "deuda conocida".

- **Fecha del último gate completo:** <fecha>
- **Rama:** `main`
- **Veredicto:** <VERDE | ROJO> (`<comando del gate>`)

## Señales

| Señal | Comando | Resultado |
|---|---|---|
| Self-test del arnés | `node scripts/harness-selftest.mjs` | <verde y qué probó> |
| Link-check de docs | `node scripts/docs-linkcheck.mjs` | <verde> |
| Lint de convenciones | `node scripts/repo-lint.mjs` | <verde> |
| <tipos> | `<comando>` | <verde> |
| <tests> | `<comando>` | <verde — N pruebas> |
| <build> | `<comando>` | <verde> |

Pre-commit instalado: <sí/no> (`core.hooksPath=.githooks`). CI corre el mismo gate: <sí/no>.

## Deuda conocida

- <lo que NO está verificado, con el mecanismo candidato para verificarlo>
- <allowlists vigentes y por qué; recordá que sólo pueden achicarse>

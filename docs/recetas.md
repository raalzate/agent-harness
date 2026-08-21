# Recetas

Situaciones concretas, con el comando al lado. Todo lo de acá asume el arnés ya instalado
(`docs/portar.md`).

---

## Agregar una señal al gate

1. Contestá: **¿qué clase de error atrapa que ninguna otra atrapa?** Si no hay respuesta, la señal
   no entra — vas a pagar su tiempo en cada corrida sin recibir información nueva.
2. Agregala a `gate.signals` con su `why` (obligatorio) y `fastSkip` si es lenta.
3. `bash scripts/gate.sh` — ¿corre? `node scripts/harness-selftest.mjs` — ¿la señal existe y es
   ejecutable?
4. Rompé a propósito lo que la señal cuida y confirmá que se pone roja.

El paso 4 es el que se saltea y el que importa.

---

## Agregar una regla del repo

Usá el skill `nuevo-freno`, o a mano:

| Lo que se puede observar | Clase de regla |
|---|---|
| un archivo importa lo que no debe | `purity` |
| un archivo contiene texto que no debe | `patterns` |
| un literal se cablea fuera de su registro | `singleSource` |
| un archivo perdió una línea que lo hacía funcionar | `invariants` |
| una dependencia entró al manifiesto | `forbiddenDeps` |
| una ruta se editó | `protectedPaths` |
| un comando irreversible se ejecutó | `bash.deny` |
| nada observable (intención, criterio) | `reviewer` + una línea REVIEW en la constitución |

Después, siempre las tres:

```bash
node scripts/harness-selftest.mjs   # ¿muerde?
node scripts/repo-lint.mjs          # ¿no muerde de más?
bash scripts/gate.sh                # ¿el repo sigue entregable?
```

---

## Medir si el arnés está vivo

```bash
/harness-audit          # el comando; o a mano:
node scripts/harness-selftest.mjs
node scripts/repo-lint.mjs --rules
git config core.hooksPath           # tiene que decir .githooks
```

Buscá el anti-patrón **"instalado y muerto"**: archivos presentes cuyo eslabón activador nunca
corre. Los tres sospechosos habituales: un hook de git en `.git/hooks/` que git ignora, una fase de
proceso documentada cuya herramienta nadie tiene instalada, y un principio BLOCKING que no nombra
ningún comando.

---

## El gate tarda demasiado

En este orden:

1. **Ordená las señales** de la más barata a la más lenta. El agente falla antes y con la señal más
   informativa.
2. **Marcá `fastSkip`** lo que sólo hace falta antes de entregar (el build). El bucle de desarrollo
   usa `gate:fast`.
3. **Paralelizá en CI**, no en local: en CI podés partir en jobs; en local la salida intercalada de
   procesos paralelos es ilegible y el agente lee peor el error.
4. **Recién al final**, considerá sacar una señal. Y antes de sacarla, leé su `why`: para eso está
   escrito. Si el `why` ya no es cierto, sacala sin culpa; si es cierto, el problema es otro.

Lo que **no** se hace: bajar el umbral de cobertura, sacar el build, o correr el gate sólo en CI.
El feedback que llega después del push llega cuando el contexto de la decisión ya se perdió.

---

## Un incidente acaba de costar dos horas

```
/lesson <el incidente en una línea>
```

El ciclo completo: minar la causa real → codificar en el mecanismo más fuerte disponible → validar
con el gate. Si el incidente **ya estaba** en `docs/gotchas.md`, el hallazgo es otro: la regla
existía y no frenó nada, así que hace falta un mecanismo más fuerte, no otra entrada de markdown.

---

## Adaptar el gate a otro stack

| Stack | Las señales que no se pueden omitir |
|---|---|
| TypeScript | `tsc --noEmit` (el runner de tests no type-checkea), tests con cobertura, build |
| Python | `ruff` + `mypy` (son distintas), `pytest --cov`, chequeo de migraciones pendientes |
| Go | `gofmt -l`, `go vet ./...`, `go test -race -count=1 ./...`, `go build ./...` |
| Java/Kotlin | `spotless:check`, `mvn verify` o `gradle check`, el empaquetado |
| Rust | `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `cargo build --release` |
| Infra | `fmt -check`, `validate`, política (OPA/conftest), **plan** — nunca `apply` |
| Datos | validación de esquema, tests de transformación, chequeo de contratos de tablas |

Configs completas en [`../examples/`](../examples/README.md). El patrón general que se repite en
todos: **formato → estático → tipos → tests → empaquetado**, con el self-test del arnés primero
(un freno roto invalida todo lo que venga después).

---

## El agente reimplementó algo que ya existía

Es el fallo más caro y más silencioso, y tiene tres pasos de arreglo:

1. Documentá la abstracción en un catálogo de reuso (una tabla: *necesidad → ya existe → no hagas*).
2. Si el patrón es detectable por regex, agregá la regla a `reuse` con su `see`.
3. Verificá con el self-test: `see` tiene que existir, y el freno tiene que morder.

Con eso, la próxima vez el agente se entera **antes** de escribir, no en el review.

---

## Quiero el arnés en veinte repos

`scripts/harness-init.mjs` copia lo genérico; lo que **no** se puede automatizar es el config, y ahí
está el valor. Dos consejos de escala:

- **Un config por repo, siempre.** La tentación de compartir un config "de la organización" termina
  en reglas que no corresponden a la mitad de los repos, y en equipos que ignoran los frenos.
- **Lo que sí conviene compartir** es esta constitución y este `docs/portar.md`: los principios y el
  método viajan; las reglas concretas, no.

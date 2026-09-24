# El ciclo de desarrollo, declarado

El modelo de ramas es la convención **menos escrita** de un repo: se explica una vez cuando alguien
entra, se ve a medias en `git log`, y nadie se entera cuando deja de cumplirse. Con un agente en el
equipo es peor: commitea en la rama donde cayó, le pone el nombre que se le ocurre y mete todo
junto, porque nadie se lo dijo — y decírselo en un prompt no es un mecanismo.

Este arnés no tiene opinión sobre qué modelo usar. Tiene dos claves de config (`workflow` y `xp`),
un comando que falla, y una regla: **lo que no se puede verificar se declara como declaración, no
como freno**.

```bash
node scripts/cycle-check.mjs --rules      # qué modelo está activo y de dónde sale
```

---

## `workflow` — el modelo de ramas

| Clave | Qué hace | ¿Verificado? |
|---|---|---|
| `model` | nombre del modelo (`trunk-based`, `github-flow`, `git-flow`, `gitlab-flow`) | informativo: es lo que el router le pone delante al agente |
| `branchPattern` | qué nombre puede tener una rama de trabajo | **sí** — `pre-push` |
| `branchExamples` | ejemplos que van en el mensaje de bloqueo | informativo |
| `longLived` | las ramas del modelo (`main`, `develop`, `release`), exentas del patrón | **sí** — exención |
| `baseBranch` | de dónde sale la rama y contra qué se mide su edad | **sí** — para la edad |
| `maxAgeDays` + `staleAction` | rama vieja = lote grande esperando (`warn` avisa, `block` frena) | **sí** — `pre-push` |
| `mergeInto` | a qué rama entra cada familia de ramas | **no**: lo decide el pull request, que el hook no ve |
| `branches.protected` | dónde se entra por PR y no de un empujón | **sí** — `pre-push` |

`mergeInto` está declarado y **no se finge verificado**: es lo que el agente lee para saber que un
`hotfix/` de git flow vuelve a `main` *y* a `develop`. Una tabla que promete más de lo que cumple
es la forma más rápida de que nadie crea en el resto.

### Los tres modelos, en config

**Trunk-based** (el de este repo): una rama larga, ramas de trabajo cortas.

```json
"workflow": {
  "model": "trunk-based",
  "branchPattern": "^(feat|fix|docs|chore|refactor|test|ci|perf)/[a-z0-9][a-z0-9._-]*$",
  "longLived": ["main"],
  "baseBranch": "main",
  "maxAgeDays": 5,
  "staleAction": "warn"
}
```

**Git flow**: dos ramas largas y familias con destino distinto (el ejemplo `git-flow` del repo del arnés).

```json
"workflow": {
  "model": "git-flow",
  "branchPattern": "^(feature|bugfix|release|hotfix|support)/[a-z0-9][a-z0-9._-]*$",
  "longLived": ["main", "master", "develop"],
  "baseBranch": "develop",
  "maxAgeDays": 10,
  "mergeInto": [
    { "branch": "^hotfix/", "into": ["main", "develop"] },
    { "branch": "^release/", "into": ["main", "develop"] },
    { "branch": "^(feature|bugfix)/", "into": ["develop"] }
  ]
}
```

**GitHub flow / GitLab flow**: como trunk-based, con `maxAgeDays` más largo y las ramas de entorno
en `longLived` (`staging`, `production`); el ejemplo `trunk-based` es el punto de partida.

### Cuánto vale cada freno

- El **nombre de la rama** se verifica en `pre-push`, que es tarde pero es cuando el nombre empieza
  a importar: antes de eso la rama es privada. Falla **antes de la red**, con el `git branch -m`
  para salir del paso.
- La **edad** se mide desde el punto donde la rama se separó de `baseBranch`, que es lo que de
  verdad dice cuánto hace que no se integra. Si no hay base local, **no se inventa un veredicto**:
  la comprobación se saltea.
- La **rama protegida** ya tenía su freno (`branches.protected`) y sigue corriendo primero: empujar
  a `main` es el error más grave y merece ser el único mensaje que se lee.
- La protección **del lado del servidor** (GitHub, GitLab, Azure) es el freno fuerte y hay que
  activarla igual. Esto es el complemento local, que funciona con cualquier forja o sin ninguna.

---

## `xp` — las prácticas que tienen mecanismo

XP trae doce prácticas. Cuatro se pueden verificar desde un hook de git; el resto es juicio, y
decirlo es parte de que se crea la tabla. Cada una se enciende sola (`enabled: true`) y **cada una
tiene fuga declarada con motivo**: la fuga es la diferencia entre un freno que se respeta y uno que
alguien saltea saltándose los hooks (que además está en `bash.deny`).

| Práctica | Qué se verifica | Qué NO | Fuga |
|---|---|---|---|
| `testFirst` | el commit que cambia comportamiento trae también un archivo de prueba (`testPattern`) | que la prueba se escribiera **antes**, ni que falle sin el cambio | `no-test: <motivo>` |
| `smallBatch` | archivos y líneas del commit bajo el límite del equipo (`maxFiles`, `maxLines`) | que el lote tenga sentido propio | `big-batch: <motivo>` |
| `refactorSeparate` | un commit que se declara `refactor:` no cambia pruebas | que el refactor sea de verdad un refactor | `mixed-refactor: <motivo>` |
| `pairing` | el commit deja rastro de con quién se hizo (`Co-authored-by:`) | que la sesión de a dos haya existido | `solo: <motivo>` |

**Qué queda como juicio, y lo mira el subagente `reviewer`:** diseño simple, propiedad colectiva
del código, integración continua de verdad (el gate en cada push es el piso, no la práctica
entera), ritmo sostenible, metáfora, y el estándar de código más allá de lo que el lint ve.

### `testFirst` cuando el repo no tiene una carpeta `tests/`

`testPattern` es un regex, no una carpeta. En **este** repo la prueba de un freno es su caso del
self-test (P2), así que el patrón nombra ese archivo:

```json
"testPattern": "(^|/)(__tests__|tests?)/|\\.(test|spec)\\.[cm]?[jt]sx?$|^scripts/harness-(selftest|bench)\\.mjs$"
```

Ese es el punto de la clave: la práctica es «el cambio entra con su prueba», y qué cuenta como
prueba lo decide el repo, no el arnés.

### Encender de a una

Una práctica encendida sin cicatriz detrás se apaga en una semana y se lleva puestas a las que
servían (P14). Por eso `pairing` viene **apagado** en este repo —con un agente y una persona, la
fuga sería la regla— y su mecanismo se prueba igual con un cebo del self-test: el freno existe y
muerde el día que alguien lo encienda.

---

## Qué pasa cuando el freno muerde

```
$ git push -u origin arreglos
ciclo: el nombre de la rama `arreglos` no sigue el modelo declarado (trunk-based).

Patrón: ^(feat|fix|docs|chore|refactor|test|ci|perf)/[a-z0-9][a-z0-9._-]*$
  ej.  fix/multiplataforma

Renombrar la rama local y volver a empujar:
  git branch -m <nombre-que-sigue-el-patrón>
```

```
$ git commit -m "fix: el router no ve los pedidos en pasado"
ciclo (XP · test primero): este commit cambia comportamiento y no trae ninguna prueba.

  - .claude/hooks/sdd-router.mjs

Elegí una, y que quede en el historial:
  1) agregá la prueba que falla sin este cambio;
  2) declaralo con motivo:  no-test: <por qué este cambio no lleva prueba>
```

---

## Prueba de vida

El freno entra por `node`, así que sus casos corren en Windows, macOS y Linux sin bash
([multiplataforma.md](multiplataforma.md)):

```bash
node scripts/harness-selftest.mjs     # nombre de rama, exención de las ramas largas, y las
                                      # cuatro prácticas: cada una muerde y cada una deja
                                      # pasar lo que se declaró
```

Las prácticas apagadas se prueban con un **cebo** (`--config <ruta>`), sin escribir nada en el
árbol de fuentes (P7).

---

Ver también: [agilidad.md](agilidad.md) (qué principio ágil tiene mecanismo),
[trazabilidad.md](trazabilidad.md) (el registro del trabajo),
[cicd.md](cicd.md) (el pipeline), y la referencia de cada clave del config en el repo del arnés,
[buenas-practicas.md](buenas-practicas.md) (la guía de fondo).

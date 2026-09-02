# Perfiles de stack

El arnés es agnóstico, pero **agnóstico no es vacío**: hay cosas de un stack que ninguna
convención de equipo decide, y hacer que cada repo las descubra a mano es la forma más rápida de
que el portado se abandone a mitad de camino.

Un perfil (`plantillas/perfiles/<stack>.json`) llena exactamente eso. Lo aplica el instalador:

```bash
node scripts/harness-init.mjs ../mi-repo                      # detecta el stack y avisa
node scripts/harness-init.mjs ../mi-repo --perfil dotnet       # explícito
node scripts/harness-init.mjs ../mi-repo --perfil node,dotnet  # monorepo: front + back
node scripts/harness-init.mjs ../mi-repo --perfil dotnet --apply
```

Perfiles publicados: `node` · `front` · `dotnet` · `jvm-maven` · `jvm-gradle` · `python` · `go` ·
`rust`.

La detección mira nombres de archivo hasta 3 niveles (`*.csproj`, `pom.xml`, `go.mod`,
`Cargo.toml`, `pyproject.toml`, `package.json`…). Si detecta **varios**, el instalador **no elige**:
los lista y te dice cómo pedirlos. Elegir por el equipo es exactamente el error que este documento
trata de evitar.

## El corte: hechos del lenguaje, no cicatrices de un repo

Es la línea que sostiene P14 —*lo que viaja son los principios, no las reglas ajenas*—. Una regla
concreta describe un incidente de **un** repo; instalada en otro es ruido bien intencionado que
gasta contexto del agente y paciencia del equipo, y termina desactivada llevándose puestas a las
que sí servían.

| **Sí** viaja en el perfil | **No** viaja: lo escribe el equipo |
|---|---|
| `gate.codeExtensions` — qué extensión es código | `gate.signals` — las señales reales del gate |
| `purityImportSyntax` — cómo se escribe un import | `patterns` — texto prohibido en un ámbito |
| `forbiddenDeps.manifest` + `matcher` | `forbiddenDeps.packages` — qué dependencia se vetó |
| `protectedPaths` de derivados (`bin/`, `obj/`, `target/`) | `reuse` — el boilerplate que este repo ya resolvió |
| `tests.filePattern` / `onlyPattern` | `singleSource`, `invariants` |
| `installHooksCommand` y el alias del gate donde el stack tiene uno estándar (`npm run gate`; en los demás queda `bash scripts/gate.sh`, que siempre funciona) | `bash.deny` propio del stack (`terraform apply`, `kubectl delete`) |
| `commitMsg.ignoreExtensions` (`.resx`, `.rst`: son del lenguaje) | `commitMsg.codePattern` — **layout del equipo**: en un repo el código vive en `src/`, en otro en `services/` |
| `docs.ignore` — directorios derivados | |

`commitMsg.codePattern` es el caso que más engaña: parece deducible y no lo es, y su modo de falla
es **silencioso y a la baja** — si apunta al directorio equivocado, `commit-msg` deja de exigir la
referencia al ítem de trabajo y P11 se apaga sin que nada se ponga rojo. Por eso está prohibido en
el perfil y el instalador lo pide explícitamente en su paso 2b.

*Mecanismo:* la regla `PERFIL` de `scripts/repo-lint.mjs` falla si un archivo de
`plantillas/perfiles/` trae cualquiera de las claves de la derecha, y el self-test prueba que muerde
con un cebo por clave. Sin ese freno, el primer apuro mete `patterns` adentro del perfil y el arnés
empieza a viajar con las cicatrices de otro equipo.

## Las señales del gate siguen vacías

Un perfil **no** puede escribir `gate.signals`. Nadie de afuera sabe si este repo se verifica con
`dotnet test`, con `dotnet test --filter`, con `make check` o con un script propio; un gate que
verifica lo que no corresponde es peor que no tener gate, porque enseña a ignorarlo.

Lo que el perfil deja son **candidatas comentadas** en `gate.$signalHints`: nombre, comando y `why`.
Se confirman leyendo el CI real del repo y se mueven a `gate.signals`. El `$` del nombre no es
decorativo: `scripts/gate.sh` sólo ejecuta `gate.signals`, así que una candidata sin revisar no
corre nunca.

## Lo que ningún perfil arregla

**El arnés corre con `node` y `bash`.** En un repo de .NET, JVM, Python o Go eso significa que node
tiene que estar en la máquina del equipo **y en el runner de CI**. Es el costo de que los hooks sean
un archivo copiable en cualquier repo: la alternativa —reescribir los 11 hooks en cada lenguaje—
mata lo único que hace portable al arnés. Está declarado acá y en [portar.md](portar.md) para que no
se descubra el día del pipeline rojo.

En CI son dos líneas más, no un problema — el runner ya instala tu SDK, y node va al lado:

```yaml
      - uses: actions/setup-dotnet@v4      # tu stack
        with: { dotnet-version: '8.0.x' }
      - uses: actions/setup-node@v4        # el arnés (sin `npm ci`: no tiene dependencias)
        with: { node-version: 20 }
      - run: bash scripts/gate.sh
```

**El perfil no reemplaza el trabajo de traducir convenciones.** Después de aplicarlo, el self-test
sigue **rojo** hasta que se llenen `gate.signals` y las reglas: ese rojo es el mapa. Cada línea
nombra la clave que todavía apunta a la nada.

## Agregar un perfil

1. `plantillas/perfiles/<stack>.json` con `$stack`, `$detect` y `gate.codeExtensions` (las tres son
   obligatorias: las exige `profiles.requiredKeys`).
2. Nada de la columna derecha de la tabla. El lint lo verifica.
3. `npm run gate`. La sección 8 del self-test instala tu perfil en un repo temporal, verifica que el
   dry-run **no escriba**, que el config generado traiga tus extensiones y que `gate.signals` haya
   quedado intacto.

No hace falta tocar ningún script: el instalador lee el directorio.

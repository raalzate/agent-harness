# CI/CD — el mismo gate, en tres lugares

> **La regla:** CI corre **exactamente** el comando que corre el humano. Si el pipeline verifica
> algo distinto, una de las dos señales miente — y la que gana es siempre la que deja mergear.

## Los tres actores, un solo comando

| Actor | Cuándo | Qué corre | Qué pasa si falla |
|---|---|---|---|
| **El humano** | antes de commitear | `.githooks/pre-commit` (rutas protegidas + lint de lo staged) | el commit no se hace |
| | antes de empujar | `.githooks/pre-push` (`branches.protected`) | el push directo a `main` no sale |
| | antes de dar por terminado | `gate.command` (`npm run gate`) | no hay entregable |
| **El agente** | al cerrar la tarea | el hook `Stop` (`gate-stop.mjs`) mira `gate.marker` | no puede cerrar la tarea |
| **CI** | en cada push y cada PR | `.github/workflows/ci.yml` → **el mismo** `npm run gate` | el PR no se mergea |

El comando es uno solo porque vive en un solo lugar: `.claude/harness.config.json` →
`gate.command`, y la lista de señales en `gate.signals`. `scripts/gate.sh` las ejecuta en orden y
no sabe de stacks.

## El pipeline, etapa por etapa

```
push / PR
   │
   ├─ gate            ← el entregable. Las señales de `gate.signals`, ninguna omitida.
   │                     Falla → no se mergea. Sin excepción por prisa.
   │
   ├─ señales lentas  ← lo que tarda demasiado para el ciclo del desarrollador
   │                     (acá: el banco con `--con-gate`, ~75s). En el gate local van
   │                     con `fastSkip`, y en CI corren completas.
   │
   └─ despliegue      ← DETRÁS del gate verde, nunca al lado. Un deploy que no depende
                         del gate convierte al gate en decoración.
```

**Modo `fast` (`gate.fastCommand`)**: omite las señales marcadas `fastSkip`. Es señal de
desarrollo — sirve para iterar, **no es entregable**, y el gate lo imprime cada vez.

## Las cuatro reglas del pipeline

1. **Un solo entregable.** La rama verde en CI y la rama verde en la máquina significan lo mismo.
   Lo verifica el `invariants` sobre `.github/workflows/ci.yml`: el archivo tiene que contener
   `npm run gate`. Si alguien lo cambia por algo más rápido, `node scripts/repo-lint.mjs` falla.
2. **Ninguna etapa tolera fallos.** El mismo invariante prohíbe `continue-on-error: true`: un job
   que falla y deja pasar es peor que no tenerlo, porque además tranquiliza.
3. **Nada se saltea la verificación.** `--no-verify` está en `bash.deny` (exit 2, con el motivo).
   Si el gate estorba, se arregla el gate; desactivarlo es una decisión de equipo, no un atajo de
   una tarde.
4. **El trabajo entra por PR.** `branches.protected` frena el push directo antes de la red. La
   protección del lado del servidor —GitHub, GitLab, Azure— es el freno fuerte y **hay que
   activarla igual**: el hook local es el complemento, y el gate no puede verificarla porque
   necesitaría red.

## Integrarlo con tu forja

El arnés **no conoce ninguna forja**. Lo que cambia de una a otra son tres cosas, y ninguna vive
en el código:

| Qué | Dónde se configura | GitHub | GitLab | Azure DevOps | Bitbucket | Jenkins |
|---|---|---|---|---|---|---|
| **correr el gate** | el archivo de pipeline | `.github/workflows/ci.yml` | `.gitlab-ci.yml` | `azure-pipelines.yml` | `bitbucket-pipelines.yml` | `Jenkinsfile` |
| **que el rojo frene el merge** | la **forja**, no el repo | *branch protection rule* → required status check | *protected branch* + «Pipelines must succeed» | *branch policy* → build validation | *branch restriction* + merge check | el plugin de la forja que reporta el estado |
| **qué cuenta como referencia al ítem** | `tracker.issuePattern` | `#123` | `#123` | `AB#1234` | `#123` / Jira | el gestor que uses |

Las tres son necesarias: el pipeline **corre** el gate, la política de rama lo vuelve
**obligatorio**, y `tracker.issuePattern` hace que el trabajo quede **registrado**. Falta una y el
sistema tiene un agujero con forma de esa.

> **El punto que más se saltea:** el archivo de pipeline **no protege nada por sí solo**. En las
> cinco forjas, "no se puede mergear en rojo" es una opción del servidor que alguien tiene que
> prender a mano. El hook `pre-push` del arnés es el complemento local —falla antes de la red— y
> el gate no puede verificar la del servidor porque necesitaría red. Está declarado así en el
> estado del arnés, no asumido.

### GitHub Actions

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # acá el setup del stack del proyecto
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: gate
        run: bash scripts/gate.sh
```

Después: **Settings → Branches → Branch protection rule** sobre `main`, con el check `gate` marcado
como *required* y "Require a pull request before merging". Sin eso, el workflow es un semáforo que
nadie mira.

### GitLab CI

```yaml
stages: [gate]
gate:
  stage: gate
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - bash scripts/gate.sh
```

Después: **Settings → Repository → Protected branches** sobre la rama default, y en **Merge
requests** marcar *Pipelines must succeed*. Ojo con `allow_failure: true`: es el equivalente
exacto de `continue-on-error`, y convierte el gate en decoración.

### Azure DevOps (Azure Pipelines + Azure Boards)

```yaml
trigger: { branches: { include: [main] } }
pr:      { branches: { include: [main] } }
pool: { vmImage: ubuntu-latest }
steps:
  # acá el setup del stack del proyecto
  - task: NodeTool@0
    inputs: { versionSpec: '20.x' }
  - script: bash scripts/gate.sh
    displayName: gate
```

Dos particularidades que hacen tropezar:

1. **La protección no está en el YAML.** Va en **Repos → Branches → Branch policies** sobre `main`:
   *Build validation* con este pipeline (política **Required**), y *Require a minimum number of
   reviewers*. Un pipeline sin build policy corre y no frena nada.
2. **El ítem de trabajo se referencia `AB#1234`**, no `#1234`. En el config:
   `"tracker": { "kind": "azure-devops", "issuePattern": "(^|[^A-Za-z0-9_])AB#[0-9]+" }`. Azure
   además puede exigir el work item linkeado al PR desde la misma política — es el mismo principio
   que el hook `commit-msg`, aplicado del lado del servidor. Los dos suman: el hook frena antes de
   que el commit exista.

### Bitbucket Pipelines

```yaml
image: node:20
pipelines:
  pull-requests:
    '**':
      - step: { name: gate, script: [bash scripts/gate.sh] }
  branches:
    main:
      - step: { name: gate, script: [bash scripts/gate.sh] }
```

Después: **Repository settings → Branch restrictions** sobre `main` y el *merge check* que exige el
build en verde.

### Jenkins

```groovy
pipeline {
  agent any
  stages {
    stage('gate') { steps { sh 'bash scripts/gate.sh' } }
  }
}
```

La tentación en Jenkins es partir el gate en una etapa por señal "para ver dónde falló". **No se
hace:** el gate ya imprime qué señal falló, y partirlo crea una segunda definición de entregable
—la del `Jenkinsfile`— que envejece aparte del config. Nada de `catchError` ni de `|| true`.

### Lo que NO cambia entre forjas

- El comando: `gate.command`. Uno solo, en el config.
- El invariante que lo verifica: el archivo de pipeline **tiene que contener** el comando del gate
  y **no** puede contener la marca de "tolera fallos" de esa forja
  (`continue-on-error`, `allow_failure`, `continueOnError`, `catchError`). Es una entrada de
  `invariants` por archivo de pipeline, y la escribe quien porta el arnés.
- Los hooks de git: `pre-commit`, `commit-msg`, `pre-push` funcionan igual en las cinco (son de
  git, no de la forja).
- El índice del código: **no corre en CI**. Es infraestructura de lectura del agente, local y
  derivada; su señal se reporta OMITIDA en el pipeline y eso es lo correcto. Ver
  [codegraph.md](codegraph.md).

## Cuando el gate tarda

El síntoma clásico: quince minutos de pipeline, y alguien empieza a mergear "en rojo, pero es un
test flaky". El orden de arreglos, del más barato al más caro:

1. **Ordenar las señales** de la más barata e informativa a la más lenta. Un self-test roto
   invalida a todas las demás: va primero. El build, último.
2. **Marcar `fastSkip`** lo que el desarrollador no necesita en cada iteración (y que CI sí corre).
3. **`skipIfMissing`** para lo que depende de una herramienta local: se reporta **OMITIDA**, nunca
   "pasó". Así viaja la señal del índice del código (ver [codegraph.md](codegraph.md)).
4. **Sacar la señal** — con nombre y apellido. Cada señal declara su `why` justamente para este
   día: si el `why` ya no es cierto, la señal se saca sin culpa. Lo que no se hace es dejarla
   fallando.

## Al portar a otro repo

`gate.signals` no se inventa: se lee del manifiesto y del CI **del repo destino**. Un perfil de
stack no trae señales a propósito (adivinar el comando de test de otro equipo es peor que no traer
nada), y cada señal que escribas declara su `why` o el self-test la rechaza. Los pasos completos
están en la receta de portado del arnés, y el comando `/harness-port` los sigue.

---

Ver también: [arnes.md](arnes.md) (las señales de este repo, una por una),
[trazabilidad.md](trazabilidad.md) (cómo entra el trabajo a la rama principal),
[agilidad.md](agilidad.md) (por qué el lote chico y el pipeline rápido son la misma decisión).

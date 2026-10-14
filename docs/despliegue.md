# Despliegue seguro — un camino, a cualquier nube

El pedido tenía dos caras, y las dos terminaban en que nadie desplegaba bien:

- **Claude Code frena en bloque** todo lo que huele a infraestructura. El agente no puede ni
  desplegar a un entorno de prueba, y el humano aprende a decir «sí» sin leer: la pregunta deja
  de proteger justo el caso raro.
- **Cuando pasa, pasa crudo**: un `kubectl apply` o un `railway up` desde una rama sucia, sin
  gate y sin registro. El incidente de producción no se puede reproducir porque nadie sabe qué
  commit llegó.

La salida no es aflojar los permisos sino darle al agente **un camino declarado** que verifica lo
que importa, y dejar el permiso humano donde de verdad decide algo.

## Las tres piezas

| Pieza | Qué hace |
|---|---|
| `deploy.targets` (config) | cada destino: `command` (array, sin shell), `approval`, `branch`, `requires`, `env`, `planCommand` |
| `scripts/deploy.mjs` (`npm run deploy`) | dry-run por defecto; `--apply` verifica las precondiciones, ejecuta y deja registro |
| `.claude/hooks/deploy-guard.mjs` | decide el permiso: autoriza el camino, pregunta lo que lo rodea, bloquea lo que destruye |

## Qué decide el hook

| El agente intenta… | Decisión | Por qué |
|---|---|---|
| `npm run deploy -- staging` (dry-run) | **autoriza** sin preguntar | sólo muestra el plan y las precondiciones |
| `… staging --apply`, destino `approval: "agent"` | **autoriza** sin preguntar | el script verifica todo antes de ejecutar |
| `… prod --apply`, destino `approval: "human"` | **pregunta** al humano, con el comando | el humano decide, después de leer el dry-run |
| `… <destino-no-declarado> --apply` | **pregunta** | nadie declaró qué hace |
| `… staging --apply && otra-cosa`, un salto de línea, `--config`, otra bandera, no-ASCII | **no opina** (permiso normal) | sólo la forma exacta hereda la autorización ([ADR 0011](decisions/0011-el-arnes-autoriza-un-camino.md)) |
| `kubectl apply`, `az webapp deploy`, `railway up`… | **pregunta**, y nombra el camino seguro | desplegar por fuera: sin gate, sin rama verificada y sin registro |
| `aws secretsmanager get-secret-value`, `railway variables`… | **pregunta** | imprime secretos al transcript |
| `terraform destroy`, `az group delete`, `kubectl delete ns`… | **bloquea** | destruye un entorno entero: lo hace el humano |
| `kubectl get pods`, `terraform plan`, `railway logs`… | **no opina** | leer no pide permiso (`deploy.passExamples` lo prueba) |
| Herramientas MCP (`mcp__<servidor>__deploy`, `…__delete-volume`) | pregunta / bloquea | `deploy.mcp`: el mismo criterio por nombre de herramienta |
| MCP que recibe un comando de CLI como texto (`cli_command`) | reglas de bash | si no, el mismo `aws … delete-stack` pasaba por MCP |

Si el comando casa una regla de `bash.deny` o `bash.ask` de `bash-guard`, `deploy-guard` no lo
autoriza: la seguridad no depende de cómo resuelve Claude Code dos decisiones de hooks distintos.

## Qué verifica `--apply`

Siempre, y sin forma de sacarla: **el config está commiteado y sin cambios**. El hook autoriza
según el config del disco, así que sin esta condición un `approval: "agent"` que el agente se
pusiera a sí mismo en el mismo turno se ejecutaría. Pasar un destino a `agent` entra por PR.

El script no acepta `--config` ni otra bandera que `--apply`: el config es el del repo donde vive.

Con `requires` ausente rigen **todas**, que es el lado seguro:

| Precondición | Qué mira | Por qué |
|---|---|---|
| `cleanTree` | nada sin commitear **ni suelto** | muchos CLIs suben el directorio, no el commit |
| `branch` | estás en `branch` del destino | a producción se despliega desde la rama que el equipo eligió |
| `synced` | `HEAD == <remote>/<branch>` tras un `fetch` | lo desplegado es lo que el equipo ve en el remoto |
| `gate` | el último gate **completo** de esta máquina salió verde sobre este HEAD | un despliegue es una entrega: P1 |
| `env` | las variables de `env` existen | se **nombran** las que faltan; nunca se imprime un valor |

Cada `--apply` que llega a ejecutar deja una línea en `deploy.ledger` (default
`.git/harness-deploys.log`, fuera del árbol): fecha, destino, commit, rama, quién y resultado.

## Destinos, por nube

`approval: "agent"` es para lo que ya se desplegó varias veces sin sorpresas (un entorno de
prueba, una preview). Empezá todo en `human` y pasá a `agent` con evidencia, no con ganas.

```json
"deploy": {
  "targets": {
    "staging": {
      "description": "Railway, entorno staging",
      "command": ["railway", "up", "--service", "web", "--environment", "staging", "--ci"],
      "approval": "agent",
      "branch": "main",
      "env": ["RAILWAY_TOKEN"]
    },
    "prod-aws": {
      "description": "ECS vía CDK",
      "command": ["npx", "cdk", "deploy", "WebStack", "--require-approval", "never"],
      "planCommand": ["npx", "cdk", "diff", "WebStack"],
      "approval": "human",
      "branch": "main",
      "env": ["AWS_PROFILE"]
    },
    "prod-azure": {
      "description": "App Service",
      "command": ["az", "webapp", "deploy", "--resource-group", "rg-web", "--name", "web", "--src-path", "dist.zip"],
      "approval": "human",
      "branch": "main"
    },
    "prod-gcp": {
      "description": "Cloud Run",
      "command": ["gcloud", "run", "deploy", "web", "--source", ".", "--region", "us-central1"],
      "approval": "human",
      "branch": "main"
    },
    "k8s": {
      "description": "clúster, con kustomize",
      "command": ["kubectl", "apply", "-k", "deploy/overlays/prod"],
      "planCommand": ["kubectl", "diff", "-k", "deploy/overlays/prod"],
      "approval": "human",
      "branch": "main"
    },
    "infra": {
      "description": "Terraform",
      "command": ["terraform", "-chdir=infra", "apply", "-auto-approve", "plan.tfplan"],
      "planCommand": ["terraform", "-chdir=infra", "plan", "-out=plan.tfplan"],
      "approval": "human",
      "branch": "main",
      "requires": ["branch", "synced", "gate"]
    }
  }
}
```

- `command` es un **array**: se ejecuta sin shell, así que nada del config se interpola ni se
  inyecta. Si el despliegue necesita un pipe, va en un script del repo, y ese script es el comando.
- `planCommand` corre en el dry-run, y **tiene que ser de sólo lectura** (`plan`, `diff`,
  `preview`): el dry-run se autoriza sin preguntar.
- El ejemplo `infra` saca `cleanTree` porque `plan.tfplan` es un archivo suelto a propósito; sin
  eso, el `plan` del dry-run volvería sucio el árbol para el `apply`.
- Los secretos **nunca** van en el config ni en el repo: `env` sólo nombra las variables, y las
  pone el humano en su shell o el CI en su almacén de secretos. Un token escrito dentro de
  `command` se imprimiría en el plan y llegaría al transcript.
- En Windows los comandos corren por `cmd.exe` (Node no lanza un `.cmd` sin shell): un argumento
  con `& | < > ^ % !` o comillas se rechaza. Si hace falta, va en un script del repo.
- `ledger` tiene que estar bajo `.git/`; si no, se usa el default.

## Del lado de Claude Code

El hook autoriza con `permissionDecision: "allow"` sólo la forma exacta del punto de entrada,
así que no hace falta abrir `permissions.allow` en `settings.json` para desplegar. Lo que **no**
conviene es agregar ahí `Bash(kubectl:*)` o `Bash(aws:*)` para que «deje de preguntar»: eso
autoriza también el `delete`, y saca al humano justo de la decisión que importa.

## Prueba de vida

```bash
node scripts/harness-selftest.mjs   # 3c-ter: cada alternativa de cada regla, por separado;
                                    # passExamples pasan sin opinión; el punto de entrada con
                                    # destinos cebo (agent, human, no declarado, encadenado)
                                    # 3c-quater: cada precondición muerde, el dry-run no ejecuta,
                                    # ningún valor de secreto se imprime, el registro es fiel
```

Lo que **no** se verifica: que el comando de un destino haga lo que dice su `description`, ni
que un `planCommand` sea de verdad de sólo lectura. Las dos cosas son juicio del que escribe el
config, y del `reviewer` en el PR.

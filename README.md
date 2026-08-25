# Agent Harness — arnés de agente portable

Infraestructura para que un agente de código trabaje sobre **tu** repo con reglas que se hacen
cumplir solas: hooks del ciclo del agente, un gate único, self-test de los frenos, subagentes,
comandos y el ciclo que convierte cada incidente en un mecanismo.

Agnóstico de lenguaje y framework. Corre con **node y bash**, sin instalar dependencias.

**→ [raalzate.github.io/agent-harness](https://raalzate.github.io/agent-harness/)** — la versión de una
pasada, con el transcript del gate y sus tres veredictos.

> **La frase que resume todo:** una regla sin un comando que la haga fallar es una sugerencia.

Este repo documenta **el método** de ingeniería de arnés ([docs/metodo.md](docs/metodo.md)), lo
muestra aplicado sobre un producto real ([docs/caso-de-estudio.md](docs/caso-de-estudio.md)), y
entrega los mecanismos listos para copiar.

Este repo se audita a sí mismo: su propio gate son las señales del arnés. Un repo de buenas
prácticas que no las cumple no convence a nadie.

---

## Instalar en tu repo

```bash
git clone <este-repo> /tmp/agent-harness && cd /tmp/agent-harness
node scripts/harness-init.mjs /ruta/a/tu/repo            # dry-run: muestra qué haría
node scripts/harness-init.mjs /ruta/a/tu/repo --apply    # escribe (nunca sobreescribe)
```

Después, en tu repo:

```bash
git config core.hooksPath .githooks   # el pre-commit real, no el .sample
node scripts/harness-selftest.mjs     # ¿los frenos muerden?
bash scripts/gate.sh                  # ¿el gate corre?
```

Lo que el instalador **no** puede hacer por vos es lo que da el valor: decidir cuáles son las
señales reales de tu repo y traducir sus convenciones a reglas. Eso es una tarde de trabajo y está
guiado paso a paso en **[docs/portar.md](docs/portar.md)**.

## Qué se instala

```
.claude/
  settings.json          en qué momento del ciclo del agente corre cada hook
  harness.config.json    ← EL ÚNICO archivo específico de tu repo
  hooks/                 8 hooks genéricos: leen la config, no tienen nada cableado
  agents/                explorer · reviewer · gate-runner
  commands/              /gate · /lesson · /harness-audit · /harness-port
  skills/nuevo-freno/    convierte una regla en prosa en un freno ejecutable
scripts/
  gate.sh                el gate: ejecuta las señales declaradas en el config
  repo-lint.mjs          las reglas del repo que ningún compilador ve
  harness-selftest.mjs   prueba de vida: ¿cada regla tiene un comando que la hace fallar?
  docs-linkcheck.mjs     que la memoria del agente no apunte a la nada
  harness-init.mjs       el instalador
.githooks/               pre-commit real + post-commit opcional
plantillas/              CONSTITUTION · CLAUDE · STATUS · gotchas · ADR · config de arranque
examples/                configs completas: TypeScript · Python · Go · monorepo · Terraform
```

## Las cinco piezas, y qué problema resuelve cada una

**1. Un gate único.** La única definición de "entregable", declarada en JSON y corrida por tres
actores con el mismo comando: el humano, el agente y CI. Si CI verifica algo distinto de lo que
verifica el desarrollador, una de las dos señales miente y nadie sabe cuál.
*Resuelve:* "en mi máquina funciona" y "el test pasa, entonces está listo".

**2. Hooks del ciclo del agente.** Frenos en los momentos donde el daño se hace: antes de escribir
(rutas protegidas, reuso), antes de un comando irreversible, después de cada edición (el lint del
archivo tocado, con el error real), y al cerrar la tarea (no se entrega con el gate rojo).
*Resuelve:* el agente que borra lo que no debía y el que dice "listo" sin verificar.

**3. Self-test del arnés.** Por cada regla del config genera una muestra concreta y verifica que el
freno la bloquee — y que **no** bloquee lo inocente. Los casos se generan solos, así que una regla
nueva queda cubierta sin escribir código.
*Resuelve:* el anti-patrón central, **"instalado y muerto"**: archivos presentes cuyo eslabón
activador nunca corre.

**4. Constitución + estado verificado.** Principios versionados donde cada uno declara su fuerza
(BLOCKING = hay un comando que falla; REVIEW = lo juzga una persona) y `STATUS.md` con **sólo** lo
verificado por un comando. Lo que se supone va en "deuda conocida".
*Resuelve:* la prosa aspiracional que nadie hace cumplir, y releer el repo entero para saber si
algo anda.

**5. El ciclo del incidente (`/lesson`).** Un problema que costó tiempo termina en el mecanismo más
fuerte disponible —test > hook/lint > comando > markdown— y esa mejora pasa el gate antes de quedar.
*Resuelve:* el equipo que tropieza dos veces con la misma piedra, y la "auto-mejora" sin control.

## Por dónde empezar a leer

| Si querés… | Leé |
|---|---|
| entender el método | [docs/metodo.md](docs/metodo.md) — el ciclo y las diez leyes, cada una con su cicatriz |
| ver el método aplicado, con números | [docs/caso-de-estudio.md](docs/caso-de-estudio.md) — un arnés real, incluida su deuda |
| la teoría de fondo | [docs/buenas-practicas.md](docs/buenas-practicas.md) — agnóstica de stack |
| instalarlo hoy | [docs/portar.md](docs/portar.md) |
| saber qué hace cada clave del config | [docs/config-reference.md](docs/config-reference.md) |
| copiar una config que ya funciona | [examples/](examples/README.md) |
| ver el arnés de este repo, señal por señal | [docs/arnes.md](docs/arnes.md) |
| que el trabajo quede registrado (en cualquier forja) | [docs/trazabilidad.md](docs/trazabilidad.md) |
| resolver algo concreto | [docs/recetas.md](docs/recetas.md) |
| saber por qué está hecho así | los ADR en [docs/decisions/](docs/decisions) — especificidad en JSON · sin dependencias · self-test generado · contrato de hooks |

## Cómo se trabaja en este repo

```bash
npm run gate          # EL entregable: self-test · link-check · lint
npm run selftest      # ¿los frenos muerden?
npm run lint:rules    # ¿qué reglas están activas y de dónde salen?
```

Las reglas de este repo están en [`CONSTITUTION.md`](CONSTITUTION.md); el estado verificado, en
[`STATUS.md`](STATUS.md); lo que ya nos costó horas, en [`docs/gotchas.md`](docs/gotchas.md).

## Lo que este arnés NO es

- **No es un sandbox.** `bash.deny` sube el costo del error accidental; un agente puede reformular
  un comando. Para aislamiento real hacen falta contenedores o permisos del sistema operativo.
- **No es un linter de estilo.** Convive con ESLint, ruff, golangci-lint. Cubre lo que ellos no:
  arquitectura y dominio.
- **No reemplaza el criterio.** La intención no es verificable por máquina: por eso hay principios
  REVIEW y un subagente que revisa el diff. El arnés hace que lo verificable **no dependa** de que
  alguien se acuerde.

## Licencia

Apache-2.0. Ver [`LICENSE`](LICENSE).

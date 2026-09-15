# Varios proyectos: monorepo, varios repos, o una plataforma entera

La pregunta llega siempre igual: *"¿pongo un arnés para todo, o uno por proyecto?"*. La respuesta
sale de otra pregunta, que es la única que importa:

> **¿Qué significa "entregable" acá — una cosa, o varias?**
>
> Si un cambio se mergea cuando **todo** está verde, hay **un** gate. Si cada pieza se mergea y se
> despliega por su cuenta, hay **un gate por pieza**. El gate no es un archivo: es la definición de
> terminado, y no puede haber dos.

De ahí salen tres formas, con sus costos reales.

---

## Forma 1 — Monorepo: un config, un gate

Varios paquetes en un repo, un solo historial, un solo pipeline.

| Decisión | Cómo queda |
|---|---|
| `harness.config.json` | **uno**, en la raíz. Es el único archivo específico del repo |
| `gate.signals` | una señal por herramienta, no por paquete: `test` corre el workspace entero. Si el runner del monorepo sabe correr sólo lo afectado (`turbo`, `nx`, `pnpm -r`, `bazel`), **esa** es la señal |
| `gate.codeGlobs` | las raíces de código: `packages/`, `apps/`, `services/` |
| `purity` | **una entrada por paquete que tenga capa pura**. Es la clave: el acoplamiento entre paquetes es el problema típico del monorepo, y `purity` con `forbiddenImports` es lo que lo frena |
| `skipIfMissing` | para el clon parcial (sparse checkout) o el paquete que todavía no existe en todas las ramas |
| índice del código | `codegraph init` en la raíz indexa todo. Si el repo es enorme, se indexa por servicio y se consulta con el `projectPath` de ese servicio |

**La regla que más rinde en un monorepo** no es una señal, es una `purity`: quién puede importar a
quién. Sin eso, en seis meses cualquier paquete importa cualquier otro y el monorepo es un
monolito con carpetas.

```json
"purity": [
  { "dir": "packages/dominio", "forbiddenImports": ["@app/ui", "@app/api", "express"],
    "reason": "el dominio no conoce ni la UI ni el transporte: es lo que sobrevive al próximo framework." },
  { "dir": "packages/ui", "forbiddenImports": ["@app/infra"],
    "reason": "la UI habla con el dominio, no con la base." }
]
```

**En CI:** un job, el gate completo. Los *path filters* (correr sólo lo que cambió) son una
optimización del runner, no del gate: si el filtro decide qué se verifica, el filtro pasó a ser la
definición de entregable, y nadie lo audita.

---

## Forma 2 — Varios repos, un equipo: un arnés por repo, principios compartidos

Cada repo tiene su historial, su pipeline y su gate. El arnés se **copia** a cada uno.

Lo que **se comparte** entre repos:

| Sí viaja | Por qué |
|---|---|
| la constitución (los principios) | son del equipo, no del repo |
| los hooks y los scripts | son genéricos: no saben de stacks |
| el método: cómo se lee el código, cómo corre el pipeline, qué exige el diseño | es criterio, no configuración |
| los perfiles de stack | son hechos del lenguaje |

Lo que **no viaja nunca**: las reglas concretas. Una regla es la cicatriz de **un** incidente en
**un** repo; instalada en otro es ruido bien intencionado que gasta contexto del agente y paciencia
del equipo. Un repo que estrena arnés arranca con cuatro frenos y crece de a uno, por incidente.

### Instalarlo en N repos

```bash
# Desde el repo del arnés, con su instalador (dry-run: muestra qué copiaría).
for r in ~/code/servicio-a ~/code/servicio-b ~/code/web; do
  node scripts/harness-init.mjs "$r"   # linkcheck:ignora — ruta del repo del ARNÉS
done
```

El instalador **no sobreescribe** nada existente y detecta el stack de cada repo para aplicar su
perfil. Después, en cada repo, lo que ninguna herramienta puede hacer sola: escribir `gate.signals`
con las señales **reales de ese repo** (leídas de su manifiesto y de su CI), y encender la
protección de rama en la forja.

### Actualizar el arnés en N repos

El costo real del multi-repo no es instalar: es **quedar desparejo**. Tres reglas que lo hacen
manejable:

1. **El config no se toca al actualizar.** Los hooks y los scripts son genéricos, así que
   actualizar es copiar archivos sin dueño local. El único archivo que cada repo posee es su
   `harness.config.json`.
2. **Dry-run primero, siempre.** El instalador lo es por default; el `--apply` es explícito.
3. **Un repo puede quedarse atrás a propósito.** Se declara en su estado, con el motivo. La deuda
   declarada se administra; la no declarada se descubre en el peor momento.

### El gestor de trabajo, con varios repos

`tracker.issuePattern` es **por repo**, y eso alcanza: un equipo con Jira suele tener un prefijo
por proyecto (`PAY-123` en uno, `WEB-123` en otro) y cada config declara el suyo. Si dos repos
comparten proyecto, comparten patrón. Ningún script del arnés conoce el gestor: aplica el regex.

---

## Forma 3 — Una plataforma: varios repos, varios lenguajes

Es la forma 2 con una vuelta más: los repos ni siquiera comparten stack (un servicio .NET, otro en
Go, un front en React, infraestructura en Terraform).

Lo que se mantiene idéntico en los cuatro:

- **el contrato del gate**: `gate.signals`, cada señal con su `why`, omitido ≠ verde;
- **el contrato de los hooks**: exit 0 sigue, exit 2 bloquea, config roto deja pasar;
- **el ciclo**: incidente → mecanismo más fuerte → gate verde;
- **la forma de leer el código**: índice primero, archivos después.

Lo que cambia por repo: las señales (`dotnet test` vs `go test ./...` vs `vitest run`), las
extensiones que cuentan como código, la sintaxis de import que mira `purity`, y el manifiesto
contra el que corre `forbiddenDeps`. Todo eso lo llena el **perfil de stack** del instalador: son
hechos del lenguaje, no decisiones del equipo.

**El error clásico de plataforma:** un equipo de plataforma escribe un config "corporativo" con
cuarenta reglas y lo empuja a todos los repos. A la semana, tres equipos comentaron los hooks. Lo
que se empuja son los principios y el mecanismo; las reglas las gana cada repo con sus incidentes.

---

## Cómo se ve en el pipeline

| Forma | GitHub Actions | GitLab CI | Azure Pipelines |
|---|---|---|---|
| **Monorepo** | un job `gate`; `paths:` sólo para no correr de más, nunca para decidir qué se verifica | un job con `rules: changes:` con el mismo criterio | un pipeline con `trigger.paths` |
| **Varios repos** | el mismo workflow copiado en cada repo (mismo nombre de check, así la política de rama es igual en todos) | `.gitlab-ci.yml` por repo; o un `include:` a un template del grupo, con el job del gate igual | un pipeline por repo; las *branch policies* se configuran repo por repo |
| **Plataforma** | igual que arriba, con el setup del stack distinto antes del paso del gate | igual | igual |

En las tres, el paso del gate es la **misma línea**: el `gate.command` del repo. El que varía es
lo que hay **antes** (instalar el SDK del stack).

---

## El índice del código con varios proyectos

El índice es **por proyecto**: se construye una vez en cada uno (`codegraph init`), se
auto-sincroniza al guardar, y queda fuera del repo porque es derivado.

- **Monorepo grande:** se puede indexar sólo lo que se está tocando. Un servicio sin índice no
  rompe nada: la consulta devuelve una guía para usar las herramientas normales.
- **Varios repos abiertos a la vez:** la consulta acepta el **proyecto** al que se le pregunta, así
  que una sesión puede mirar el servicio y el front sin mezclarlos.
- **En CI no corre.** Es infraestructura de lectura del agente, no una señal de calidad del código:
  su señal se reporta OMITIDA en el pipeline y así está bien.

---

## La tabla de decisión

| Pregunta | Respuesta → forma |
|---|---|
| ¿Un cambio se mergea cuando **todo** está verde? | sí → **monorepo, un gate** · no → un gate por repo |
| ¿Las piezas se despliegan juntas? | sí → un gate · no → uno por pieza |
| ¿Los equipos son distintos y deciden distinto? | sí → **varios repos**, principios compartidos |
| ¿Los repos usan lenguajes distintos? | sí → **plataforma**: mismo contrato, perfiles distintos |
| ¿Querés un config "corporativo" único con todas las reglas? | **no**. Las reglas viajan sin cicatriz y se desactivan a mano en una semana |

---

Ver también: [cicd.md](cicd.md) (el pipeline en cada forja), [codegraph.md](codegraph.md) (el
índice), [arquitectura.md](arquitectura.md) (acoplamiento entre paquetes),
[trazabilidad.md](trazabilidad.md) (el registro, en cualquier gestor).

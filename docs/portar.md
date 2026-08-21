# Portar el arnés a tu repo

Una tarde de trabajo, en este orden. El orden importa: cada paso hace verificable al siguiente.

> **Regla de oro:** no copies reglas, copiá **cicatrices**. Cada regla que instales tiene que
> corresponder a algo que ya te pasó o que ya te dio miedo. Un arnés con veinte reglas
> hipotéticas y ninguna real es peor que no tener arnés: entrena al equipo a ignorar los frenos.

---

## Paso 0 — Instalar los archivos (5 minutos)

```bash
git clone <este-repo> /tmp/agent-harness
cd /tmp/agent-harness
node scripts/harness-init.mjs /ruta/a/tu/repo            # dry-run: muestra qué haría
node scripts/harness-init.mjs /ruta/a/tu/repo --apply    # escribe
```

Copia los hooks, los scripts, los subagentes, los comandos, `.githooks/` y las plantillas.
**No sobreescribe nada**: lo que ya existe lo reporta como conservado.

En tu repo, agregá al manifiesto (`package.json`, `Makefile`, `justfile`, lo que uses):

```
gate       → bash scripts/gate.sh
gate:fast  → bash scripts/gate.sh fast
```

Y activá el pre-commit real:

```bash
git config core.hooksPath .githooks
```

Esto último no es opcional. `.git/hooks/` sólo tiene `.sample`: una herramienta que "instala su
hook" ahí lo deja escrito, se ve bien y **nunca corre**.

> **El self-test va a estar rojo, y está bien.** El config de arranque trae placeholders a
> propósito. Ese rojo es el **mapa** de lo que falta: cada línea nombra la clave que todavía apunta
> a la nada. Los pasos 1 a 3 son exactamente el trabajo de apagarlo. Y lo que no aplique a tu repo
> se **borra**, no se deja con el placeholder puesto.

---

## Paso 1 — Definir el gate (la decisión más importante)

El gate es la única definición de "entregable" de tu repo. Se declara en
`.claude/harness.config.json` → `gate.signals`.

Para encontrar tus señales reales, mirá **el CI que ya tenés** y el manifiesto. Después, para
cada candidata, contestá la única pregunta que decide si entra:

> **¿Qué clase de error atrapa esta señal que NINGUNA otra atrapa?**

Esa respuesta se escribe en el campo `why`. Una señal sin `why` no entra — el self-test la
rechaza. No es burocracia: cuando el gate tarde y alguien quiera sacar una señal, `why` es lo
único que la va a defender.

Las cuatro señales que casi todo repo necesita, y por qué no se solapan:

| Señal | Atrapa lo que las otras no |
|---|---|
| Tipos / compilación completa | los runners de test transpilan o cargan **por archivo** y no ven el proyecto: un import inválido pasa los tests |
| Tests con cobertura | comportamiento; no ve tipos ni empaquetado |
| Build de producción | dev y prod difieren: tree-shaking, resolución de módulos, minificado, empaquetado |
| Lint de convenciones del repo | las reglas de arquitectura y dominio que ninguna config estándar conoce |

Más las dos del propio arnés, que ya vienen instaladas: **self-test** (los frenos muerden) y
**link-check** (la memoria del agente no apunta a la nada).

Marcá con `fastSkip: true` lo lento (típicamente el build): eso es lo que omite el modo `fast`.
Y grabate la regla: **fast verde no es entregable**, y una señal **omitida no es verde**.

Verificación del paso:

```bash
bash scripts/gate.sh          # ¿corre? ¿falla cuando algo está roto de verdad?
```

Probá que el gate puede ponerse rojo. Un gate que nunca falló todavía no es un gate: es una
esperanza. Rompé algo a propósito (un tipo, un test) y confirmá que lo caza.

---

## Paso 2 — Rutas protegidas y comandos denegados (30 minutos, el mejor retorno)

Estos dos frenos son los que evitan el daño irreversible, y se llenan sin pensar mucho:

**`protectedPaths`** — qué NUNCA edita el agente. Empezá por: secretos, lockfiles, `.git/`,
derivados (`build/`, `dist/`, `coverage/`), código generado, migraciones ya aplicadas, y la
configuración de producción.

**`bash.deny`** — qué comandos no tienen ctrl-Z **en tu stack**. Los genéricos ya vienen. Agregá
los tuyos, y sé concreto:

| Stack | Lo propio que hay que denegar |
|---|---|
| Node | `npm publish`, `npm install --force` |
| Python | `pip install` suelto, `manage.py flush`, `alembic downgrade` |
| Go | `go mod vendor`, `go clean -modcache` |
| Infra | `terraform apply`/`destroy`, `-auto-approve`, `kubectl delete` |
| Datos | `DROP TABLE`, `TRUNCATE`, borrado en el bucket de producción |

Cada regla lleva `reason`, y el `reason` es lo que el agente lee cuando lo bloqueás: es tu única
oportunidad de que entienda en vez de reintentar. Escribí el porqué, no la prohibición.

> **Detalle real:** escribir estas reglas mientras el arnés está activo hace que el propio
> `bash-guard` bloquee tus comandos, porque el texto de la config **contiene** los patrones que
> deniega. Es la prueba de vida más honesta que vas a tener. Escribí ese archivo con el editor,
> no con un heredoc del shell.

Verificación del paso:

```bash
node scripts/harness-selftest.mjs
```

El self-test **genera una muestra por cada regla que escribiste** y verifica que el hook la
bloquee. No hace falta escribir casos de prueba a mano: si la regla vive en el config, ya está
cubierta. Lo que el self-test no puede reducir a un ejemplo lo reporta como **omitido** (nunca
como pasado) para que lo pruebes vos.

---

## Paso 3 — Las reglas de tu arquitectura

Ahora lo que hace específico a tu repo. Cuatro preguntas, cuatro clases de regla:

**¿Qué capa tiene que quedar limpia?** → `purity`. La capa de lógica pura (dominio, `lib/`,
`internal/domain`) que no importa framework, red ni UI. Es lo único que va a sobrevivir al
próximo cambio de framework, y lo único donde exigir cobertura tiene sentido.

**¿Qué registro es la única fuente de verdad?** → `singleSource`. Los tipos de un dominio, los
códigos de error, las rutas, los feature flags. La regla bloquea cablear esos literales fuera del
registro. La `allow` list es **deuda declarada**: sólo puede achicarse, y crecer se justifica en
`STATUS.md`.

**¿Qué archivo tiene invariantes que nadie debe romper?** → `invariants`. El arranque del proceso,
los flags que hacen andar el motor, el apagado ordenado, el backend del estado. Líneas `required`
que no pueden desaparecer y `forbidden` que no pueden aparecer.

**¿Qué texto no debería existir nunca en cierto ámbito?** → `patterns`. La clase más usada:
secretos leídos desde el cliente, `console.log` en producción, `any` en el dominio, `panic` en una
librería, un `except` desnudo. Cada patrón lleva `message` con el porqué y la alternativa.

Verificación del paso:

```bash
node scripts/repo-lint.mjs --rules   # ¿qué quedó activo?
node scripts/repo-lint.mjs           # ¿el repo pasa? (si no, o arreglás o declarás la deuda)
node scripts/harness-selftest.mjs    # ¿cada regla muerde?
```

Las tres, siempre. La segunda es la que se olvida y la que importa: un freno que bloquea trabajo
legítimo se desactiva a mano en una semana, y se lleva puestos a los frenos que sí servían.

---

## Paso 4 — Memoria y evidencia

Cuatro archivos, cada uno con **un** trabajo. La plantilla de cada uno está en
[`../plantillas/`](../plantillas).

| Archivo | Su único trabajo | Cuándo se carga |
|---|---|---|
| `CLAUDE.md` | reglas operativas y convenciones | siempre |
| `CONSTITUTION.md` | principios versionados, con su fuerza y su mecanismo | siempre |
| `STATUS.md` | **estado verificado** con el comando que lo verificó | en cada `SessionStart` |
| `docs/gotchas.md` | incidentes: síntoma · causa · regla · mecanismo | bajo demanda |

En `CONSTITUTION.md`, la disciplina que sostiene todo: un principio **BLOCKING nombra el comando**
que falla si se lo viola. Si no podés nombrarlo, el principio es **REVIEW**. Etiquetar de BLOCKING
lo que nadie verifica es la forma más rápida de que nadie crea en el documento.

En `STATUS.md` va sólo lo verificado con un comando. Lo que se supone va en "deuda conocida".
La diferencia entre esas dos secciones es la diferencia entre un arnés y un deseo.

---

## Paso 5 — Cerrar el bucle

1. **CI corre el mismo gate.** No una versión parecida: el mismo comando. Si CI verifica algo
   distinto de lo que verifica el desarrollador, una de las dos señales miente y nadie sabe cuál.
2. **El hook `Stop` está activo.** El agente no puede cerrar una tarea con código editado y el
   gate sin correr (marcador `gate.marker`).
3. **`/harness-audit`** una vez, para tener la línea base de madurez.
4. **`/lesson`** cada vez que algo cueste tiempo. Es el mecanismo por el que el arnés crece solo,
   y el único que garantiza que las reglas nuevas tengan una cicatriz detrás.

---

## Checklist de portado

Copiá esto a un issue del repo destino:

```
[ ] harness-init corrido; core.hooksPath = .githooks
[ ] gate.signals con las señales REALES del repo, cada una con su `why`
[ ] el gate se puede poner ROJO (probado a propósito)
[ ] protectedPaths: secretos, lockfiles, derivados, generados, config de producción
[ ] bash.deny: los comandos sin ctrl-Z de ESTE stack
[ ] purity: la capa que tiene que quedar limpia
[ ] al menos una regla de singleSource / invariants / patterns con cicatriz detrás
[ ] selftest verde; lint verde; el lint NO bloquea trabajo legítimo
[ ] CONSTITUTION.md: cada BLOCKING nombra su comando
[ ] STATUS.md: sólo lo verificado, con el comando al lado
[ ] CI corre EL MISMO gate
[ ] /harness-audit corrido: nivel de madurez anotado en STATUS.md
```

## Los tres errores que más se cometen al portar

1. **Copiar el config de otro repo tal cual.** Las reglas ajenas describen los incidentes ajenos.
   El resultado es un arnés que estorba y no protege.
2. **Etiquetar todo BLOCKING.** Un principio sin comando que falle es REVIEW. Mentir en la etiqueta
   destruye la confianza en el documento completo.
3. **Instalar y no verificar.** Es el anti-patrón central: *instalado y muerto*. Archivos presentes
   cuyo eslabón activador nunca corre. El antídoto es una línea: `node scripts/harness-selftest.mjs`.

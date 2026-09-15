# El índice del código es obligatorio — codegraph

> **La regla, en una línea:** *primero el índice, después abrir archivos* — y sólo el fragmento que
> el índice señaló.

La herramienta es [codegraph](https://github.com/colbymchenry/codegraph): un grafo de conocimiento
del repo (símbolos, llamadas, radio de impacto) en una base SQLite **local**, sin API keys y sin
que el código salga de la máquina. El arnés no la conoce por dentro: la declara en
`.claude/harness.config.json` → `graph`, igual que declara cualquier otra cosa específica.

## Por qué no es opcional

Un agente sin índice contesta "¿dónde está X?" recorriendo el árbol: `ls`, `grep`, abrir archivos,
descartar, abrir más. Eso tiene tres costos que se pagan en cada sesión y ninguno se ve en un log:

| Costo | Cómo se manifiesta |
|---|---|
| **Contexto quemado** | veinte lecturas para una respuesta que cabía en dos. El contexto que gastó buscando es el que le falta para razonar. |
| **Relaciones invisibles** | `grep` encuentra el nombre, no el **flujo**: quién llama a quién, qué implementa qué interfaz, qué se rompe si toco esto. El despacho dinámico (callbacks, re-render, interfaz → implementación) no deja rastro textual. |
| **Radio de impacto estimado de memoria** | la causa arquetípica del cambio que rompe algo lejano. Nadie estima bien lo que no puede ver. |

El tercero es el que más caro sale y el que justifica la exigencia: **el acoplamiento no se opina,
se mide**, y lo que lo mide es el grafo (ver [arquitectura.md](arquitectura.md)).

## Instalación (una vez por máquina, una vez por repo)

```bash
# 1. la CLI (no necesita Node)
curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh

# 2. conectarla a los agentes de esta máquina (Claude Code entre ellos)
codegraph install

# 3. construir el índice de ESTE repo
codegraph init
```

`codegraph init` crea `.codegraph/` y construye el grafo en el mismo paso. A partir de ahí se
**auto-sincroniza** al guardar: no hay nada que re-correr, y `codegraph status` dice si quedó algo
pendiente.

> `.codegraph/` es **derivado**: se regenera. Va al `.gitignore`, y el config lo declara en
> `protectedPaths` — el agente no edita un índice, lo reconstruye.

## Cómo se consulta

| Situación | Qué se corre |
|---|---|
| "¿cómo funciona X?", "¿cómo llega X a Y?", "¿qué hay en esta zona?" | `codegraph explore "<pregunta>"` — devuelve el código verbatim de los símbolos relevantes agrupado por archivo, las rutas de llamada entre ellos y el radio de impacto |
| desde el agente (MCP) | la herramienta `codegraph_explore`, que es la misma llamada |
| "¿el índice está al día?" | `codegraph status` |
| mirarlo con los ojos | `codegraph ui` |

Una llamada contesta casi todo. Si después de `explore` hace falta abrir un archivo, se abre **ese**
archivo y **ese** rango: el índice ya dijo dónde.

## Qué lo hace cumplir (y qué no)

| Mecanismo | Fuerza | Qué hace |
|---|---|---|
| señal del gate **índice del código (codegraph)** | alta | corre `codegraph status`. Si `.codegraph/` no existe se reporta **OMITIDA**, y una señal omitida **no es verde**: la omisión es el recordatorio, impreso en cada gate |
| hook `graph-first` (`UserPromptSubmit`) | media | con el índice construido, cuando el pedido es "dónde/quién usa/qué rompe/acoplamiento", pone la regla delante del agente antes de que abra nada. Callado si no hay índice: un hook que habla sin tener qué ofrecer se deja de leer |
| `protectedPaths` → `^\.codegraph/` | alta | el agente no edita el índice (`node .claude/hooks/protected-paths.mjs` devuelve exit 2) |
| subagente `explorer` | media | su paso 1 es el índice; `Grep`/`Glob` son el recurso para lo que el grafo no ve (strings, comentarios, config) |

**Lo que ningún comando puede verificar:** que el agente haya consultado el índice *antes* de leer.
Eso es juicio del `reviewer` — un cambio que abrió quince archivos para tocar dos es un hallazgo.

## Si tu equipo usa otro índice

El hook no conoce ninguna herramienta: lee `graph.graphFile`, `graph.queryCommand` y
`graph.questionPatterns`. Un LSP, `ctags` o un grafo propio entran cambiando esas tres claves, y la
señal del gate cambia su `command`. Lo que **no** es negociable es la regla: índice antes que
lectura. Sin índice, el agente vuelve al modo caro.

---

Ver también: [arquitectura.md](arquitectura.md) (para qué se usa el grafo al decidir diseño), la
clave `graph` en la referencia del config, y el ADR de `docs/decisions/` que explica por qué es
obligatorio y no "recomendado".

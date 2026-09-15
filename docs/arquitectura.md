# Arquitectura: qué se documenta, y cómo se mide el acoplamiento

Dos cosas distintas viven acá, y conviene no mezclarlas:

1. **La documentación de arquitectura** — qué se escribe, dónde, y cuándo es obligatorio.
2. **Bajo acoplamiento y alta cohesión** — qué significan operativamente y **qué comando falla**
   cuando se violan. Un principio de diseño sin comando es una charla de pasillo.

---

## 1. Qué se documenta

| Artefacto | Dónde | Cuándo es obligatorio | Qué NO va |
|---|---|---|---|
| **Mapa de módulos** — qué capas hay, quién puede depender de quién | `docs/arquitectura.md` de cada repo (este documento en el arnés) | siempre: es la única vista que un agente puede leer entera | diagramas que repiten el árbol de directorios |
| **ADR** — una decisión estructural, con su contexto y sus alternativas | `docs/decisions/`, con número correlativo; la plantilla la deja ahí el instalador | cuando la decisión **restringe** algo a futuro: una capa nueva, una dependencia que entra, un límite que se mueve, un formato de datos | decisiones reversibles en una tarde |
| **El porqué en el código** | comentario sobre la línea | cuando el "qué" ya se lee solo y el "porqué" no | comentarios que narran el código |

**Regla de oro del ADR:** se escribe **antes** de mover el código, y viaja en el **mismo commit**
que el movimiento. Un ADR escrito después es una justificación; escrito antes, es una decisión. El
refactor sin ADR se revierte solo a los tres meses, cuando nadie recuerda contra qué se estaba
optimizando.

**La vista que no se escribe a mano:** el grafo de llamadas y el radio de impacto salen del índice
(`codegraph explore`, ver [codegraph.md](codegraph.md)). Un diagrama dibujado a mano miente apenas
alguien mergea; el grafo se sincroniza solo. Se dibuja lo que el grafo **no** puede derivar: la
intención, los límites y las prohibiciones.

---

## 2. Bajo acoplamiento y alta cohesión, en comandos

Las dos son la misma decisión vista de los dos lados: **qué sabe cada módulo del resto**. La
traducción operativa del arnés:

| Principio | Qué significa acá | Regla del config que lo hace cumplir | Comando que falla |
|---|---|---|---|
| **Alta cohesión** | un módulo tiene una razón de cambio; lo que cambia junto vive junto | `purity` (una capa con un propósito y sin import prohibido), `singleSource` (un registro es la única fuente de un literal) | `node scripts/repo-lint.mjs` |
| **Bajo acoplamiento — hacia afuera** | la lógica no depende del framework, de la red ni de la UI | `purity.forbiddenImports` sobre la capa de dominio | `node scripts/repo-lint.mjs` |
| **Bajo acoplamiento — dependencias** | el repo decide qué NO entra, y lo decide una vez | `forbiddenDeps` contra el manifiesto real del stack | `node scripts/repo-lint.mjs` |
| **Bajo acoplamiento — duplicación** | el mismo conocimiento en dos lados son dos módulos acoplados por copia | `reuse` (boilerplate con abstracción ya existente) | el hook `reuse-guard` (exit 2), y el lint |
| **Invariantes de arranque** | el orden y los flags que nadie puede "limpiar" sin romper todo | `invariants` sobre el archivo concreto | `node scripts/repo-lint.mjs` |

En este repo esas reglas están instanciadas así: los hooks no lanzan procesos (`purity` con dos
excepciones **declaradas**), los nombres de evento salen sólo de `.claude/settings.json`
(`singleSource`), `harness.mjs` conserva su contrato de exit codes (`invariants`), y el arnés no
tiene dependencias (`forbiddenDeps`). Cada una nació de una cicatriz; el detalle está en
[gotchas.md](gotchas.md).

### El movimiento se declara

Todo cambio de diseño contesta **tres preguntas** antes de tocar un archivo — el hook `sdd-router`
las pone delante cuando el pedido menciona arquitectura, acoplamiento, cohesión o refactor:

1. **¿Cuál es el radio de impacto?** Medido con el índice (`codegraph explore "<símbolo>"`), no de
   memoria. Si el radio es mayor que lo que esperabas, esa sorpresa **es** el hallazgo.
2. **¿Qué mejora: acoplamiento o cohesión?** Decilo en una línea. "Queda más prolijo" no es una
   respuesta; "el dominio deja de importar el cliente HTTP, y eso se verifica con `purity`" sí.
3. **¿Qué regla nueva lo sostiene?** Un límite que sólo existe en la cabeza de quien lo movió, se
   cruza en el siguiente sprint. Si el movimiento crea una frontera, la frontera se escribe en el
   config — y el freno llega con su caso de self-test.

### Lo que el gate no puede ver

- Que un módulo **cohesivo** lo sea de verdad: el lint mide imports, no responsabilidades.
- Que un ADR describa la decisión real y no la que quedó linda.
- Que la capa de dominio esté *bien* dividida.

Todo eso es juicio del subagente `reviewer`, y está declarado como tal: etiquetar de automático lo
que nadie verifica es la forma rápida de que nadie crea en este documento.

---

Ver también: [codegraph.md](codegraph.md) (medir antes de mover), [cicd.md](cicd.md) (dónde corren
estas reglas), y la referencia del config del arnés para las claves `purity`, `reuse`,
`singleSource`, `invariants` y `forbiddenDeps`.

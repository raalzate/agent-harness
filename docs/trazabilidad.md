# Trazabilidad — que el trabajo quede registrado

Un cambio de producción que nadie registró existe sólo en la cabeza de quien lo hizo y en el diff.
No se puede priorizar, no se puede asignar, no aparece en ningún avance, y cuando alguien pregunta
"¿por qué cambió esto?" seis meses después, la respuesta es arqueología.

Con un agente el problema se agrava por una razón concreta: **el agente es rápido**. Cuatro
arreglos pueden estar terminados en una sesión sin que ninguno haya pasado por un ítem de trabajo,
y el registro se hace de memoria al final — o no se hace. El criterio no es un mecanismo.

> **La regla:** si el commit toca código, el mensaje referencia el ítem de trabajo **o declara por
> qué no lo lleva**. Saltarse el registro es una decisión firmada que queda en el historial, no un
> silencio.

Este arnés **no conoce ninguna forja**. GitHub, GitLab, Azure DevOps, Bitbucket con Jira, Gitea,
Linear o una planilla: lo que se configura es qué cuenta como referencia, y el mecanismo es el
mismo.

---

## El mecanismo

`.githooks/commit-msg` frena el commit cuando toca código y no queda registrado. Se configura con
dos claves de `.claude/harness.config.json`:

```json
"tracker": {
  "kind": "github",
  "issuePattern": "(^|[^A-Za-z0-9_])#[0-9]+",
  "issueExample": "#123 · Refs #123 · Closes #123",
  "newIssueHint": ["Bug o mejora acotada:  gh issue create --title \"…\""]
},
"commitMsg": {
  "codePattern": "^(src/|lib/|scripts/)",
  "ignoreExtensions": [".md", ".png", ".svg"],
  "skipSubjects": ["Merge ", "Revert ", "fixup! ", "squash! "],
  "escapeLine": "sin-issue:"
}
```

Lo que hace, en orden:

1. **Merge, revert y los commits de arreglo pasan.** Los escribe git o los reescribe el rebase: no
   hay decisión humana nueva que declarar.
2. **Sólo el código pide registro.** `codePattern` decide qué es código; `ignoreExtensions` deja
   pasar documentación y capturas aunque vivan dentro de esas rutas. Un `.md` no es el cambio: es el
   registro.
3. **Busca la referencia** con `issuePattern` en cualquier parte del mensaje.
4. **O acepta la fuga declarada**, en su propia línea y **con motivo**:
   `sin-issue: renombre interno, sin cambio de comportamiento`. Un `sin-issue:` pelado no alcanza —
   sería la misma omisión con otro nombre.
5. Si no hay ninguna de las dos, **el commit no entra** y el mensaje de error dice exactamente qué
   archivos de código lo dispararon y cuáles son las dos salidas.

Instalación: `git config core.hooksPath .githooks`. Sin eso, el hook está en el repo y nunca corre
(ver `docs/gotchas.md`).

## Cómo se configura en cada forja

| Forja / gestor | Referencia en el commit | `tracker.issuePattern` | Crear el ítem desde la terminal |
|---|---|---|---|
| **GitHub** | `#123`, `Refs #123`, `Closes #123` | `(^\|[^A-Za-z0-9_])#[0-9]+` | `gh issue create --title "…"` |
| **GitLab** | `#123`, `Closes #123` | igual que GitHub | `glab issue create --title "…"` |
| **Azure DevOps (Boards)** | `AB#123`, `Fixes AB#123` | `\bAB#[0-9]+\b` | `az boards work-item create --type Bug --title "…"` |
| **Jira** (con Bitbucket o cualquier repo) | `PROJ-123` | `\b(PROJ\|OPS)-[0-9]+\b` | la web, o un CLI de Jira |
| **Gitea / Forgejo** | `#123` | igual que GitHub | `tea issue create --title "…"` |
| **Linear** | `ENG-123` | `\b(ENG\|OPS)-[0-9]+\b` | `linear issue create` o la web |
| **Ninguno todavía** | — | omitir `tracker`: el freno no corre | primero decidan dónde vive el trabajo |

**Cuidado con los patrones tipo Jira.** `\b[A-Z]{2,}-[0-9]+\b` parece razonable y caza `UTF-8`,
`SHA-256`, `HTTP-2` y `ISO-8601`: cualquier commit que mencione un estándar pasaría el freno sin
registrar nada. **Anclá los prefijos reales de tus proyectos** (`\b(PROJ|OPS|INFRA)-[0-9]+\b`). Es
la diferencia entre un freno y un adorno, y el self-test no puede distinguirla por vos: un patrón
demasiado ancho *también* caza su propia muestra.

## Dónde viven los artefactos de una feature

Spec, plan, checklist y tareas tienen dos casas posibles, y las dos son defendibles:

| | En el repo (`specs/`) | En el gestor de trabajo |
|---|---|---|
| **A favor** | viajan con el clon, se versionan con el código, se revisan en el mismo PR, funcionan sin red | cada tarea tiene dueño, estado y cierre; el avance se ve sin `git pull`; se puede priorizar junto al resto |
| **En contra** | no se pueden asignar, no tienen estado propio, los lee sólo quien ya clonó | hace falta red y permisos; el artefacto deja de viajar con el código |

Lo que **no** es defendible es tener las dos a medias. Es adonde se llega sin un freno: alguien deja
un `plan.md` "por ahora", y a los seis meses la mitad del trabajo está de un lado y la mitad del
otro, sin que nadie sepa cuál manda.

Por eso la decisión se declara y se verifica:

```json
"tracker": { "artifactsIn": "tracker", "specsDir": "specs", "allowedInRepo": ["specs/README.md"] }
```

```bash
node scripts/artifacts-check.mjs   # señal del gate — NO toca la red
```

Con `artifactsIn: "tracker"`, cualquier archivo bajo `specs/` que no esté en `allowedInRepo` pone el
gate en rojo. Con `artifactsIn: "repo"`, lo verificable es que el directorio exista de verdad. Al no
tocar la red, la señal corre igual en tu máquina y en CI — que es la razón por la que un check de
trazabilidad puede vivir en el gate y un check contra la API de la forja no.

**Lo que se queda en el repo en cualquiera de los dos casos** es lo que explica *el código*:
decisiones (`docs/decisions/`), incidentes (`docs/gotchas.md`) y el arnés (`docs/arnes.md`). Esos no
son trabajo pendiente: son memoria, y tienen que viajar con el clon.

### Espejar la memoria en el gestor, sin perder la fuente

Si el equipo quiere citar un gotcha o un ADR desde una discusión, se puede **espejar** cada uno como
un ítem cerrado con su etiqueta (`gotcha`, `adr`) y anotar el número en el archivo:

```markdown
### GOTCHA: el hook instalado que nunca corre

Issue: #95
```

Dos condiciones para que esto no se vuelva un problema: el **archivo sigue siendo la fuente** (es lo
que exige la regla `incidents` del lint y lo que viaja con el clon), y el comando que espeja es
**idempotente y no borra archivos**. El espejo es una comodidad de lectura, no el original.

## Qué es ejecutable y qué no

| Regla | Mecanismo |
|---|---|
| Un commit de código queda registrado | `.githooks/commit-msg` — **BLOCKING**, con fuga declarada y firmada |
| La fuga tiene motivo | el mismo hook: `sin-issue:` sin texto no pasa |
| Los artefactos están donde se decidió | `node scripts/artifacts-check.mjs` en el gate, sin red |
| El freno frena de verdad | 6 casos del self-test en un repo git temporal, derivados del config |
| El agente pregunta **antes**, no al final | ruta `issue` del `sdd-router` — **informa, no bloquea** |
| El registro es el *correcto* (feature con issue madre y tareas, no un bug suelto) | ninguno: es criterio del agente y del `reviewer`. Deuda declarada |

Ese último renglón es la parte honesta: el freno pide *un* registro, no el registro *adecuado*.
Distinguir una feature de un arreglo acotado sigue siendo juicio, y por eso está en `STATUS.md` como
deuda en vez de fingir que una máquina lo cubre.

## El error de portado más común

Configurar `tracker` copiando el `issuePattern` de otro equipo. Si tu forja usa `PROJ-123` y quedó
el `#123` de GitHub, el freno **nunca** va a encontrar la referencia y todo el mundo va a terminar
escribiendo `sin-issue:` como ritual — que es exactamente el fracaso que este mecanismo evita.
Después de configurarlo, probalo en los dos sentidos:

```bash
node scripts/harness-selftest.mjs   # ¿frena un commit de código sin referencia?
                                    # ¿deja pasar uno con la referencia real de tu forja?
```

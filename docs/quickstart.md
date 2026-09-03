# Quick start — de cero a gate verde en 10 minutos

Un ejemplo completo y chico: un to-do de consola de cuatro archivos, con el arnés instalado y
**tres frenos que muerden de verdad**. Todo lo de acá se corrió tal como está escrito; las salidas
son reales, no ilustrativas.

Para qué sirve: entender el arnés viéndolo funcionar antes de traducir las convenciones de tu repo
—que es el trabajo real y está en [portar.md](portar.md)—. Para eso, la mitad del valor de este
documento es el archivo que se copia en el paso 3: [`examples/quickstart.json`](../examples/quickstart.json),
un config completo y comentado que se lee de una sentada.

**Requisitos:** `node` 20+, `git`, y una terminal normal. Cero dependencias: no hay `npm install`.

---

## 1. La app (2 min)

Cuatro archivos con una separación que después el arnés hace cumplir: `src/lib/` **decide**
(lógica pura, sin disco), `src/almacen.mjs` es el **único** que toca `tareas.json`, `src/cli.mjs`
orquesta.

```bash
mkdir -p mi-todo/src/lib mi-todo/tests && cd mi-todo && git init -q -b main .

cat > src/lib/puntaje.mjs <<'EOF'
/** Puntaje de una tarea. Lógica pura: sin disco, sin consola, testeable sin montar nada. */
const PESO = { urgente: 100, normal: 10, "algún día": 1 };

export const puntaje = (tarea, hoy = new Date()) => {
  const dias = Math.max(0, Math.floor((hoy - new Date(tarea.creada)) / 86400000));
  return (PESO[tarea.prioridad] ?? PESO.normal) + dias;
};

export const ordenar = (tareas, hoy = new Date()) =>
  [...tareas].sort((a, b) => puntaje(b, hoy) - puntaje(a, hoy));
EOF

cat > src/almacen.mjs <<'EOF'
/** El ÚNICO lector/escritor de tareas.json: valida el formato y tolera que no exista. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const RUTA = "tareas.json";

export const cargar = () => {
  if (!existsSync(RUTA)) return [];
  const datos = JSON.parse(readFileSync(RUTA, "utf8"));
  if (!Array.isArray(datos)) throw new Error("tareas.json debería ser una lista");
  return datos;
};

export const guardar = (tareas) => writeFileSync(RUTA, `${JSON.stringify(tareas, null, 2)}\n`);
EOF

cat > src/cli.mjs <<'EOF'
/** Orquesta: I/O por acá, decisiones en src/lib. */
import { cargar, guardar } from "./almacen.mjs";
import { ordenar } from "./lib/puntaje.mjs";

const [comando, ...resto] = process.argv.slice(2);

if (comando === "agregar") {
  const tareas = cargar();
  tareas.push({ titulo: resto.join(" ") || "(sin título)", prioridad: "normal", creada: new Date().toISOString() });
  guardar(tareas);
  console.log(`agregada: ${tareas.at(-1).titulo}`);
} else {
  const [siguiente] = ordenar(cargar());
  console.log(siguiente ? `→ ${siguiente.titulo}` : "nada pendiente");
}
EOF

cat > tests/puntaje.test.mjs <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { ordenar, puntaje } from "../src/lib/puntaje.mjs";

const hoy = new Date("2026-01-10T00:00:00Z");
const tarea = (prioridad, creada) => ({ titulo: prioridad, prioridad, creada });

test("urgente pesa más que normal el mismo día", () => {
  assert.ok(puntaje(tarea("urgente", "2026-01-10"), hoy) > puntaje(tarea("normal", "2026-01-10"), hoy));
});

test("una tarea vieja sube en la lista", () => {
  assert.ok(puntaje(tarea("normal", "2026-01-01"), hoy) > puntaje(tarea("normal", "2026-01-10"), hoy));
});

test("ordenar no muta la lista original", () => {
  const lista = [tarea("normal", "2026-01-10"), tarea("urgente", "2026-01-10")];
  ordenar(lista, hoy);
  assert.equal(lista[0].prioridad, "normal");
});
EOF

printf 'node_modules/\ncoverage/\n' > .gitignore
node --test && node src/cli.mjs agregar "probar el arnés" && node src/cli.mjs
```

Sale `pass 3`, `agregada: probar el arnés` y `→ probar el arnés`. Hasta acá no hay arnés: hay tres
convenciones **en la cabeza de quien escribió el código**. Ese es el punto de partida de cualquier
repo.

## 2. Instalar el arnés (1 min)

```bash
git clone https://github.com/raalzate/agent-harness /tmp/agent-harness
node /tmp/agent-harness/scripts/harness-init.mjs .            # dry-run: muestra qué haría
node /tmp/agent-harness/scripts/harness-init.mjs . --apply
```

```
Perfil de stack (detectado): node

DRY-RUN: 38 archivo(s) a copiar, 0 conservado(s).
```

Detectó el stack por el `package.json` y aplicó el **perfil `node`**: qué extensión es código, cómo
se escribe un import, dónde viven las dependencias. Eso es lo único deducible del lenguaje — el
resto lo escribís vos ([perfiles.md](perfiles.md) explica dónde está la frontera y por qué).

Falta el manifiesto y los hooks de git:

```bash
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
p.type="module";
p.scripts={...p.scripts,gate:"bash scripts/gate.sh","gate:fast":"bash scripts/gate.sh fast",
  selftest:"node scripts/harness-selftest.mjs",lint:"node scripts/repo-lint.mjs",
  test:"node --test","hooks:install":"git config core.hooksPath .githooks"};
fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");'
npm run hooks:install
```

`core.hooksPath` no es opcional: `.git/hooks/` sólo tiene `.sample`, así que una herramienta que
"instala su hook" ahí lo deja escrito, se ve bien y **nunca corre**.

## 3. El config: el único archivo específico (1 min)

Acá se copia uno ya escrito para esta app. **Leelo**: son 250 líneas comentadas y es el 80 % de
entender el arnés.

```bash
cp /tmp/agent-harness/examples/quickstart.json .claude/harness.config.json
npm run selftest | tail -1
```

```
SELF-TEST VERDE — cada regla del config tiene un comando que falla si se la viola.
```

Cuatro reglas, cada una nacida de una cicatriz del ejemplo:

| Regla | Qué dice | Qué error atrapa |
|---|---|---|
| `purity` | `src/lib` no importa `node:fs` ni `node:path` | si la lógica lee el disco, testearla exige un archivo de verdad y deja de ser lógica |
| `reuse` | sólo `src/almacen.mjs` lee `tareas.json` | un segundo lector duplica la validación del formato y se desincroniza |
| `protectedPaths` | `tareas.json` no lo edita el agente | son datos del usuario; un JSON mal escrito a mano deja la lista ilegible y sin backup |
| `bash.deny` | nada de `rm … tareas.json` | es el único estado del programa y no hay backup |

> **Para tu repo, no copies este archivo.** Las reglas ajenas describen incidentes ajenos: un arnés
> con veinte reglas hipotéticas y ninguna real entrena al equipo a ignorar los frenos. La receta
> para escribir el tuyo es [portar.md](portar.md).

## 4. Verlos morder (3 min)

Un freno que nunca se vio fallar es una esperanza. Los hooks reciben por stdin lo mismo que les
manda Claude Code, así que se pueden ejercitar a mano — **nada de esto modifica un archivo**:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm tareas.json"}}' | node .claude/hooks/bash-guard.mjs; echo "exit=$?"
```

```
COMANDO BLOQUEADO: `rm tareas.json`
Motivo: `tareas.json` es el único estado del programa y no hay backup. Si querés empezar de cero,
movelo: `mv tareas.json tareas.json.bak`.
Reformulá el comando o pedí confirmación explícita al humano. No lo reintentes igual.
exit=2
```

```bash
echo "{\"cwd\":\"$PWD\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$PWD/tareas.json\",\"content\":\"[]\"}}" \
  | node .claude/hooks/protected-paths.mjs; echo "exit=$?"
```

```
RUTA PROTEGIDA: `tareas.json` no se edita desde el agente.
Motivo: son los datos del usuario. Se cambian con el CLI (`node src/cli.mjs agregar …`), nunca
editando el archivo: un JSON mal escrito a mano deja la lista ilegible y sin backup.
Si el cambio hace falta de verdad, pedíselo al humano y que lo haga él.
exit=2
```

```bash
echo "{\"cwd\":\"$PWD\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$PWD/src/cli.mjs\",\"content\":\"const t = JSON.parse(readFileSync('tareas.json'));\"}}" \
  | node .claude/hooks/reuse-guard.mjs; echo "exit=$?"
```

```
REUSO: esto ya tiene abstracción en el repo (src/cli.mjs).
Motivo: leer o escribir `tareas.json` es trabajo de `src/almacen.mjs`, que valida el formato y no
revienta si el archivo no existe. Un segundo lector duplica esa lógica y se desincroniza.
Mirá primero: src/almacen.mjs
exit=2
```

**`exit=2` es la parte que importa**, y el texto es lo único que el agente lee cuando lo frenás: por
eso cada regla lleva su `reason`. Un bloqueo sin motivo produce un reintento; con motivo, produce
otra decisión.

## 5. El gate: la única definición de «entregable» (1 min)

```bash
npm run gate
```

```
──▶ self-test del arnés      ✓
──▶ link-check de docs       ✓
──▶ lint de convenciones     ✓
──▶ tests de la lógica       ✓
──▶ artefactos en su lugar   ✓

GATE VERDE — entregable.
```

Ahora rompelo a propósito, que es la única forma de saber que sirve:

```bash
printf 'import { readFileSync } from "node:fs";\n' | cat - src/lib/puntaje.mjs > /tmp/p && mv /tmp/p src/lib/puntaje.mjs
npm run gate 2>&1 | tail -6
```

```
──▶ lint de convenciones
repo-lint: 1 problema(s)

  src/lib/puntaje.mjs:1  [PUREZA]  `src/lib` no importa `node:fs`. `src/lib` decide, el resto
  orquesta: si la lógica lee el disco, testearla exige un archivo de verdad y deja de ser lógica.

    ✗ lint de convenciones

GATE ROJO — señales fallidas: lint de convenciones
```

Tres cosas para notar:

1. **El error trae archivo, línea y regla.** Es lo que hace la diferencia entre que el agente
   corrija la causa y que reintente a ciegas.
2. **El gate no se detiene en la primera señal roja.** Corre todas: saber que además fallan los
   tests cambia el plan.
3. **Con Claude Code, esto se ve antes.** El hook `post-edit-check` corre el lint **del archivo que
   se acaba de tocar** y devuelve ese mismo error en el momento, no diez ediciones después.

Dejalo como estaba:

```bash
git checkout -- src/lib/puntaje.mjs 2>/dev/null || sed -i '' '1d' src/lib/puntaje.mjs
npm run gate | tail -1     # GATE VERDE — entregable.
```

## 6. Qué acabás de montar

| Convención que estaba en la cabeza de alguien | Freno que la hace cumplir | Comando que falla |
|---|---|---|
| la lógica no toca el disco | `purity` | `npm run lint` |
| un solo lector de `tareas.json` | `reuse` | hook `reuse-guard` (exit 2) |
| los datos no se editan a mano | `protectedPaths` | hook `protected-paths` + `pre-commit` |
| no se borra el estado sin backup | `bash.deny` | hook `bash-guard` (exit 2) |
| nada se entrega sin verificar | el gate + hook `Stop` | `npm run gate` |

Y **cero líneas de código nuevo**: sólo un JSON. Eso es lo que quiere decir "la especificidad va en
el config".

## 7. Y ahora, tu repo

En este orden, que es el que hace verificable cada paso:

1. [**portar.md**](portar.md) — la receta completa, de una tarde: cómo se eligen las señales reales,
   cómo se traducen las convenciones a reglas, y los tres errores que más se cometen.
2. [**perfiles.md**](perfiles.md) — si tu repo es de .NET, JVM, Python, Go, Rust o front: qué llena
   el perfil y qué tenés que escribir vos.
3. [**config-reference.md**](config-reference.md) — cada clave, quién la lee, qué se rompe si la tocás.
4. [**metodo.md**](metodo.md) — por qué está hecho así: las once leyes, cada una con su cicatriz.

Y la regla que resume todo: **una regla sin un comando que la haga fallar es una sugerencia.**

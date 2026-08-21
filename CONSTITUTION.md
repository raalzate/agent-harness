# Constitución — Agent Harness

**Versión 1.0.0** · Principios que no se negocian **en este repo**. Las convenciones operativas
viven en `CLAUDE.md`; el arnés que hace cumplir estos principios, en `docs/arnes.md`.

Cada principio dice su **fuerza**:

- **BLOCKING** — hay un comando que falla si se viola. No hay excepción por prisa.
- **REVIEW** — no es verificable por máquina todavía; lo evalúa el subagente `reviewer`.

Un principio BLOCKING **nombra su comando**. Si no se puede nombrar, es REVIEW: etiquetar de
BLOCKING lo que nadie verifica es la forma más rápida de que nadie crea en este documento.

Enmendar esta constitución es un commit propio, con el número de versión subido y el motivo en el
cuerpo. Un principio que nadie hace cumplir se borra o se convierte en mecanismo.

---

## P1 — Nada se entrega sin gate verde · BLOCKING

El entregable es `npm run gate`: self-test del arnés, link-check de docs y lint de convenciones.
Una señal **omitida** no es verde, y `gate:fast` verde tampoco.

*Mecanismo:* `scripts/gate.sh`, el hook `Stop` (`.claude/hooks/gate-stop.mjs`) y el job `gate` de CI.

## P2 — Todo freno prueba que muerde · BLOCKING

Un freno sin prueba de vida es decorativo, y este repo no puede predicar lo que no practica. Toda
regla del config queda cubierta por el self-test automáticamente; **toda clase de regla nueva o
hook nuevo llega con su caso escrito a mano**.

*Mecanismo:* `node scripts/harness-selftest.mjs` — verifica que cada hook exista y parsee, que cada
ruta y regex del config resuelva, y que cada regla bloquee una muestra concreta derivada de ella.

## P3 — Todo freno prueba que NO muerde de más · BLOCKING

Un freno que bloquea trabajo legítimo se desactiva a mano en una semana, y se lleva puestos a los
que sí servían. Cada validación es doble: ¿muerde? y ¿el repo sigue pasando?

*Mecanismo:* el gate corre `node scripts/repo-lint.mjs` sobre el repo entero, y el self-test incluye
casos de "deja pasar lo inocente" (un archivo normal, un `git status`).

## P4 — La especificidad va en el config, no en el código · BLOCKING

Los hooks y los scripts son **genéricos**. Toda regla, ruta, patrón y comando propio de un repo vive
en `.claude/harness.config.json`. Cambiar una regla debe ser editar JSON; portar el arnés debe ser
reescribir un archivo.

*Mecanismo:* regla `EVENTOS` (`singleSource`) del lint — los nombres de evento del ciclo del agente
salen de `.claude/settings.json` y no se cablean en los hooks — más el `reviewer` para el resto: un
literal de dominio en un script es un hallazgo bloqueante.

## P5 — El contrato de los hooks se respeta · BLOCKING

Exit 0 = seguir (y el stdout de `UserPromptSubmit`/`SessionStart` entra al contexto del agente);
exit 2 = bloquear, y stderr es lo único que el agente lee. Un `exit 1` es un error del hook, no una
decisión: no bloquea nada y pasa desapercibido. Un config ausente o inválido **nunca** bloquea al
humano.

*Mecanismo:* regla `INVARIANTE` del lint sobre `.claude/hooks/harness.mjs` (exige `process.exit(2)` y
`process.exit(0)`, prohíbe `process.exit(1)`).

## P6 — Cada señal del gate declara qué error atrapa · BLOCKING

Ninguna señal entra sin su campo `why`. Es lo único que la va a defender el día que el gate tarde y
alguien la quiera sacar; y si el `why` deja de ser cierto, la señal se saca sin culpa.

*Mecanismo:* el self-test rechaza una señal sin `why`.

## P7 — El arnés no escribe en el árbol de fuentes · BLOCKING

Probar un freno no puede crear archivos dentro del código: un watcher vivo los ve aparecer y
desaparecer, y el build muere con un error que nadie puede reproducir. El contenido se pasa por
stdin y la ruta sólo elige las reglas.

*Mecanismo:* el modo `--stdin` de `scripts/repo-lint.mjs` y un caso del self-test que falla si
quedaron temporales en la raíz.

## P8 — Rutas protegidas · BLOCKING

Secretos, lockfiles, `.git/`, dependencias y derivados no los edita el agente. La guía de fondo
(`docs/buenas-practicas.md`) se enmienda en su propio commit, no como efecto colateral de otra
tarea. Excepción legítima: la pide el humano y el cambio lo hace él.

*Mecanismo:* `.claude/hooks/protected-paths.mjs` + `.githooks/pre-commit`, ambos leyendo la misma
lista del config.

## P9 — Acciones amplias: dry-run y reversibilidad · BLOCKING

Antes de borrar, mover o reescribir en lote: commit o backup previo, mostrar la lista, esperar
confirmación, después ejecutar. El instalador es dry-run por defecto y nunca sobreescribe.

*Mecanismo:* `.claude/hooks/bash-guard.mjs` (`bash.deny`) y el modo `--apply` explícito de
`scripts/harness-init.mjs`.

## P10 — La documentación no apunta a la nada · BLOCKING

La memoria del agente es infraestructura: un puntero roto manda a leer un archivo que no existe y
gasta el turno. Las rutas se miden contra `git ls-files`, no contra el disco — medir contra el disco
deja pasar punteros a archivos gitignored: verde local, rojo en CI, la peor variante de señal.

*Mecanismo:* `node scripts/docs-linkcheck.mjs` en el gate.

## P11 — Conducta ante el error · REVIEW

Leer la salida real (archivo, línea, mensaje) antes de reintentar; reintentar sólo con hipótesis
nueva; presupuesto de **2 intentos** sobre el mismo error, y al tercero se para y se escala con el
diagnóstico. Fallar rápido y con causa vale más que degradar en silencio.

## P12 — Cada incidente deja infraestructura · BLOCKING

Un problema que costó tiempo termina en el mecanismo más fuerte disponible (test > hook/lint >
comando > markdown), y esa mejora pasa el gate antes de quedar. `/lesson <incidente>` es el ciclo.
Si el incidente ya estaba registrado, el hallazgo es otro: la regla existía y no frenó nada, así
que hace falta un mecanismo **más fuerte**, no otra entrada de markdown.

*Mecanismo:* regla `INCIDENTE` del lint — todo bloque `### GOTCHA` de `docs/gotchas.md` declara
**Síntoma / Causa / Regla / Mecanismo**. Que el mecanismo elegido sea el más fuerte posible sigue
siendo juicio (`reviewer`); que un incidente quede sin mecanismo escrito, no.

## P13 — Lo que viaja son los principios, no las reglas ajenas · REVIEW

Las reglas concretas describen los incidentes de **un** repo; en otro son ruido bien intencionado
que gasta contexto del agente y paciencia del equipo. Lo que se comparte entre repos es esta
constitución, el método de portado y las clases de regla. Una regla instalada sin cicatriz detrás
es un hallazgo de review.

---

### Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0.0 | 2026-08-21 | Primera versión (ver `docs/decisions/0001-arnes-portable.md`). |

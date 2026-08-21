# Constitución — <PROYECTO>

**Versión 1.0.0** · Principios que no se negocian. Lo demás (convenciones, dominio, cómo se hacen
las cosas) vive en `CLAUDE.md`; el arnés que los hace cumplir, en `docs/arnes.md`.

Cada principio dice su **fuerza**:

- **BLOCKING** — hay un comando que falla si se viola. No hay excepción por prisa.
- **REVIEW** — no es verificable por máquina todavía; lo evalúa el subagente `reviewer`.

> **Regla de honestidad:** un principio BLOCKING **nombra el comando** que falla. Si no podés
> nombrarlo, el principio es REVIEW. Etiquetar de BLOCKING lo que nadie verifica es la forma más
> rápida de que nadie crea en esta constitución.

Enmendar esta constitución es un commit propio, con el número de versión subido y el motivo en el
cuerpo. Un principio que nadie hace cumplir se borra o se convierte en mecanismo.

---

## P1 — Nada se entrega sin gate verde · BLOCKING

Test verde ≠ compila ≠ entregable. El entregable es el gate completo: <señales de este repo>.
Una señal **omitida** no es verde.

*Mecanismo:* `scripts/gate.sh`, el hook `Stop` (`.claude/hooks/gate-stop.mjs`) y el job del CI.

## P2 — Integridad de aserciones · BLOCKING

Jamás se ajusta una aserción para que un test pase. Si el test es correcto, se arregla producción.
Si el test es incorrecto, se corrige **en un commit aparte** con la justificación en el mensaje.

*Mecanismo:* el propio test + revisión del diff (`reviewer`). Falsear esto exige mentir en un commit.

## P3 — TDD en la capa de lógica · BLOCKING

<capa> es lógica pura y es lo único con cobertura exigida. Toda función nueva o cambio de
comportamiento llega con su prueba.

*Mecanismo:* <comando de cobertura> en el gate + regla PUREZA de `scripts/repo-lint.mjs`.

## P4 — <principio propio del dominio> · BLOCKING

<Lo que en este proyecto no se negocia: dónde viven los secretos, qué corre offline, qué
compatibilidad se mantiene, qué contrato público no se rompe.>

*Mecanismo:* <regla del config o test que lo hace fallar>.

## P5 — Superficie de extensión declarada · BLOCKING

Agregar una capacidad nueva es declararla en <registro>. El núcleo (<archivos cerrados>) sólo se
toca para agregar un motor nuevo, no una capacidad.

*Mecanismo:* regla `singleSource` / `patterns` del config + test del registro.

## P6 — Rutas protegidas · BLOCKING

`.env*`, lockfiles, `.git/` y los artefactos derivados no los edita el agente. Excepción legítima:
la pide el humano y el cambio lo hace él.

*Mecanismo:* `.claude/hooks/protected-paths.mjs` + `.githooks/pre-commit`.

## P7 — Acciones amplias: dry-run y reversibilidad · BLOCKING

Antes de borrar, mover o reescribir en lote: commit o backup previo, mostrar la lista, esperar
confirmación, después ejecutar.

*Mecanismo:* `.claude/hooks/bash-guard.mjs` (`bash.deny` del config).

## P8 — Conducta ante el error · REVIEW

Leer la salida real (archivo, línea, mensaje) antes de reintentar; reintentar sólo con hipótesis
nueva; presupuesto de **2 intentos** sobre el mismo error, y al tercero se para y se escala con el
diagnóstico. Fallar rápido y con causa vale más que degradar en silencio.

## P9 — Cada incidente deja infraestructura · BLOCKING

Un problema que costó tiempo termina en el mecanismo más fuerte disponible (test > hook/lint >
comando > markdown), y esa mejora pasa el gate antes de quedar. `/lesson <incidente>` es el ciclo.
Una regla que ya garantiza un test se borra del markdown: la prosa duplicada sólo gasta contexto.

*Mecanismo:* regla INCIDENTE de `scripts/repo-lint.mjs` — todo gotcha declara
**Síntoma / Causa / Regla / Mecanismo**.

---

### Historial

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0.0 | <fecha> | Primera versión, al montar el arnés. |

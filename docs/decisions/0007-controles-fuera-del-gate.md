# ADR 0007 — Los controles caros o que dependen del reloj van fuera del gate, con quien los corra

- **Fecha:** 2026-09-24
- **Estado:** aceptado
- **Relacionado:** [0003](0003-selftest-generado.md), [0006](0006-banco-en-paralelo.md), [guias-y-sensores.md](../guias-y-sensores.md)

## Contexto

Adaptar el marco de guías y sensores ([guias-y-sensores.md](../guias-y-sensores.md)) dejó tres
huecos que un comando podía cerrar, pero ninguno cabía en el gate de cada commit:

- **la prueba que falla sin el cambio** (`--verify-red`) corre la suite entera sobre otro árbol:
  duplica el costo más caro del gate;
- **la deriva** (un STATUS vencido) depende del reloj: el mismo commit es verde el lunes y rojo el
  martes, y un gate que cambia de color sin cambio enseña a ignorarlo;
- **la prueba de vida del reviewer** llama a un modelo: cara, lenta y no determinista.

Meterlos al gate lo haría lento e inestable, y un gate así se saltea (ADR [0006](0006-banco-en-paralelo.md)
existe por lo mismo). Dejarlos en un script que nadie invoca es el anti-patrón que el arnés entero
combate: instalado y muerto.

## Decisión

**Un control que no va en el gate declara en su clave del config el pipeline que lo corre
(`runner`), y el self-test verifica que ese pipeline lo invoque** — por el script o por su nombre de
npm. Encendido y sin nadie que lo corra es rojo.

- `--verify-red` corre en CI sobre cada PR (`.github/workflows/ci.yml`).
- La deriva y el eval del reviewer corren en un barrido semanal (`.github/workflows/drift.yml`),
  junto con el gate sobre `main` sin cambios.
- Un control inferencial se mide con una **tasa** contra un umbral, no con todo o nada: exigirle
  certeza a un juez probabilístico produce un rojo intermitente que se aprende a ignorar.
- La máquina de cada control sí es determinista y sí va en el self-test (y por lo tanto en el gate):
  revisores de mentira, repos git temporales, STATUS de cebo. Lo que queda afuera es sólo la
  corrida cara.

## Consecuencias

- Un rojo del barrido semanal no lo produjo ningún PR: hay que mirarlo aunque nadie haya tocado
  nada. Por eso el workflow corre también el gate sobre `main`.
- La prueba del reviewer necesita un secreto (`ANTHROPIC_API_KEY`); sin él el paso se omite con un
  aviso, y omitido no es verde.
- El primer uso local del eval destapó que un revisor con Bash corre el gate por su cuenta y ensucia
  la sesión de al lado (ver `docs/gotchas.md`): el eval ahora aísla al revisor y es rojo si toca el
  estado de la sesión.

#!/usr/bin/env node
/**
 * drift-check — el barrido de deriva: lo que se degrada sin que ningún cambio lo rompa.
 *
 * El gate mide un cambio. Hay cosas que se pudren sin cambio: un STATUS.md que dice «verde»
 * desde hace dos meses (y el hook de sesión se lo imprime al agente como verdad), o una regla
 * que nunca cazó nada en el historial (¿tiene cicatriz detrás, o se instaló porque sí? P14).
 * Es la etapa «continua» del ciclo que estaba vacía (el marco de guías y sensores, en la documentación de agent-harness).
 *
 * Por qué NO es una señal del gate: depende del reloj. Un gate que se pone rojo porque pasó
 * un martes, sin que nadie haya cambiado nada, enseña a ignorar el gate. Corre programado
 * (`drift.runner`), a la derecha de todo.
 *
 * Qué mide (todo sale de `drift` en el config; sin la clave, no corre):
 *   - la edad del veredicto de `status.file` contra `drift.statusMaxAgeDays` → ROJO si venció;
 *   - las reglas de contenido (`patterns`, `reuse`) que no casan con ninguna línea agregada
 *     o quitada en los últimos `drift.historyCommits` commits → AVISO, no rojo: puede ser una
 *     regla sin cicatriz, o una que ya ganó (nadie lo vuelve a intentar). Decide un humano.
 *
 *   node scripts/drift-check.mjs [--config <ruta>]
 *
 * Exit: 0 = sin deriva (o sólo avisos) · 1 = deriva que hay que atender. Corre en CI, no es un
 * hook del agente: el contrato 0/2 no aplica.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const i = args.indexOf("--config");
const rutaConfig = i !== -1 && args[i + 1] ? path.resolve(args[i + 1]) : path.join(process.cwd(), ".claude", "harness.config.json");

let config;
try {
  config = JSON.parse(fs.readFileSync(rutaConfig, "utf8"));
} catch {
  console.log("drift-check: OMITIDO — no hay config legible.");
  process.exit(0);
}
const spec = config.drift;
if (!spec) {
  console.log("drift-check: OMITIDO — el repo no declara `drift`.");
  process.exit(0);
}

const rojos = [];
const avisos = [];
const compila = (p) => {
  try {
    return p ? new RegExp(p) : null;
  } catch {
    return null; // el regex inválido lo reporta el self-test
  }
};

// ── 1. La edad del veredicto ─────────────────────────────────────────────────
{
  const archivo = config.status?.file;
  const reFecha = compila(spec.statusDatePattern);
  const maximo = Number(spec.statusMaxAgeDays ?? 0);
  if (archivo && reFecha && maximo) {
    let texto = null;
    try {
      texto = fs.readFileSync(path.join(process.cwd(), archivo), "utf8");
    } catch {
      rojos.push(`\`${archivo}\` no existe: el hook de sesión no tiene veredicto que mostrar.`);
    }
    if (texto !== null) {
      const fecha = reFecha.exec(texto)?.[1];
      const ms = fecha ? Date.parse(fecha) : NaN;
      if (Number.isNaN(ms)) {
        rojos.push(`\`${archivo}\` no declara la fecha de su veredicto (\`statusDatePattern\`): sin fecha, nadie sabe si sigue siendo cierto.`);
      } else {
        const dias = Math.floor((Date.now() - ms) / 86400000);
        if (dias > maximo)
          rojos.push(
            `\`${archivo}\` declara un veredicto de hace ${dias} días (máximo ${maximo}). El agente lo lee al arrancar como si fuera de hoy: corré el gate y actualizalo.`,
          );
        else console.log(`  ✓ el veredicto de \`${archivo}\` tiene ${dias} día(s) (máximo ${maximo})`);
      }
    }
  }
}

// ── 2. Reglas sin cicatriz en el historial ──────────────────────────────────
{
  const n = Number(spec.historyCommits ?? 0);
  // Sin `appliesTo` la regla aplica a todo, igual que en el lint: `new RegExp("")` casa siempre.
  const reglas = [...(config.patterns ?? []), ...(config.reuse ?? [])]
    .map((r) => ({ nombre: r.id ?? r.pattern, re: compila(r.pattern), ambito: r.appliesTo ? compila(r.appliesTo) : /(?:)/ }))
    .filter((r) => r.re && r.ambito);
  if (n > 0 && reglas.length) {
    const log = spawnSync("git", ["log", "-p", "--no-color", "--format=", `-n${n}`], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (log.status !== 0) {
      avisos.push("no pude leer el historial de git: las reglas sin cicatriz no se midieron.");
    } else {
      // El archivo sale de `diff --git a/… b/…`, y `---`/`+++` sólo son encabezado ANTES del primer
      // `@@`. Adentro de un hunk, una línea quitada `-- comentario` (SQL, Lua, Haskell) se ve como
      // `--- comentario`: leerla como encabezado cambiaba el archivo y sacaba del ámbito al resto
      // del hunk. Lo cazó el reviewer. Un archivo borrado conserva su nombre (el de `b/` es el mismo).
      const vistas = new Set();
      let archivo = "";
      let enEncabezado = false;
      for (const linea of log.stdout.split("\n")) {
        if (linea.startsWith("diff --git ")) {
          archivo = / b\/(.*)$/.exec(linea)?.[1] ?? "";
          enEncabezado = true;
          continue;
        }
        if (enEncabezado) {
          if (linea.startsWith("@@")) enEncabezado = false;
          continue;
        }
        if (!/^[+-]/.test(linea)) continue;
        for (const r of reglas) if (!vistas.has(r) && r.ambito.test(archivo) && r.re.test(linea.slice(1))) vistas.add(r);
        if (vistas.size === reglas.length) break;
      }
      const nunca = reglas.filter((r) => !vistas.has(r));
      for (const r of nunca)
        avisos.push(
          `la regla \`${r.nombre}\` no casó con ninguna línea en los últimos ${n} commits. ¿Tiene cicatriz detrás (P14), o ya ganó? Decidilo y dejalo escrito. (Se compara línea por línea: un patrón que cruza líneas puede salir acá sin serlo.)`,
        );
      if (!nunca.length) console.log(`  ✓ las ${reglas.length} reglas de contenido cazaron algo en los últimos ${n} commits`);
    }
  }
}

console.log("");
for (const a of avisos) console.log(`  ! ${a}`);
if (rojos.length) {
  for (const r of rojos) console.error(`  ✗ ${r}`);
  console.error(`\nDERIVA — ${rojos.length} cosa(s) se degradaron sin que ningún cambio las rompiera.${spec.reason ? ` ${spec.reason}` : ""}`);
  process.exit(1);
}
console.log(`\nSIN DERIVA${avisos.length ? ` (${avisos.length} aviso(s) para que decida un humano)` : ""}.`);

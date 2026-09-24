#!/usr/bin/env node
/**
 * Mantiene el panel al día SOLO cuando hubo cambio de verdad.
 *
 * Un panel que hay que acordarse de regenerar es un panel viejo: se mira, dice «gate verde» de
 * anteayer y nadie sabe que está mirando una foto. Regenerarlo sin motivo es el otro extremo —
 * CPU para reescribir los mismos bytes. Por eso se decide con una FIRMA: la versión del modelo de
 * memoria (el hash del modelo entero, no de los archivos), el estado de trabajo de cada repo según
 * git y la fecha del registro del gate. Si la firma coincide con la del último panel escrito, no
 * se hace nada.
 *
 * El gate regenera siempre (su corrida ES un cambio). Esto es para lo demás: un `post-commit`
 * (`postCommit.command` en el config), un cron, o quien quiera el panel fresco sin correr el gate.
 *
 *   node scripts/panel/sincronizar.mjs            regenera si cambió
 *   node scripts/panel/sincronizar.mjs --forzar   regenera igual
 *   node scripts/panel/sincronizar.mjs --estado   sólo dice si está al día (no escribe)
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { construirModelo, specDelPanel } from "./leer-fuentes.mjs";
import { gitPorDefecto } from "./leer-en-vivo.mjs";
import { generarPanel, resolverSalida, RAIZ } from "./generar.mjs";

/** Una corrida abandonada (proceso muerto, máquina apagada) no puede dejar el panel congelado para siempre. */
const CANDADO_VENCE_MS = 5 * 60 * 1000;

const sha = (texto) => createHash("sha256").update(texto).digest("hex").slice(0, 12);

const leerJson = (ruta) => {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
};

/** La firma completa: qué dice la memoria, qué dice cada árbol de trabajo y cuándo corrió el gate. */
export function firmaActual(raiz, { config, git = gitPorDefecto } = {}) {
  const spec = specDelPanel(config);
  const modelo = construirModelo(raiz, { config });
  const dirs = [raiz, ...spec.repos.filter((r) => r.path).map((r) => path.resolve(raiz, r.path))];
  const arboles = dirs.map((d) => `${d}\n${git(d, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"])}`).join("\n");
  const registro = leerJson(path.join(raiz, modelo.reglas.gate.registry));
  return { firma: sha(`${modelo.version}\n${arboles}\n${registro?.fecha ?? ""}`), version: modelo.version };
}

function candadoVivo(ruta) {
  try {
    return Date.now() - fs.statSync(ruta).mtimeMs < CANDADO_VENCE_MS;
  } catch {
    return false;
  }
}

/** Regenera si la firma cambió. Nunca lanza: devuelve qué pasó y por qué. */
export async function sincronizar(raiz, { forzar = false, soloEstado = false, git = gitPorDefecto } = {}) {
  const config = leerJson(path.join(raiz, ".claude/harness.config.json")) ?? {};
  const spec = specDelPanel(config);
  if (!spec.enabled) return { accion: "apagado" };
  const dir = resolverSalida(raiz, spec.out);
  const sello = path.join(dir, ".sello.json");
  const candado = path.join(dir, ".sincronizando");
  const { firma, version } = firmaActual(raiz, { config, git });
  const previo = leerJson(sello);
  if (!forzar && fs.existsSync(path.join(dir, "index.html")) && previo?.firma === firma) return { accion: "al-dia", firma, version, dir };
  if (soloEstado) return { accion: "pendiente", firma, version, firmaVieja: previo?.firma ?? null, dir };
  if (candadoVivo(candado)) return { accion: "en-curso", firma, version, dir };

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(candado, String(process.pid), "utf8");
    await generarPanel(raiz, { config });
    fs.writeFileSync(sello, JSON.stringify({ firma, version }, null, 2) + "\n", "utf8");
    return { accion: "regenerado", firma, version, dir };
  } catch (e) {
    return { accion: "error", firma, version, error: String(e?.message ?? e), dir };
  } finally {
    fs.rmSync(candado, { force: true });
  }
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const argv = process.argv.slice(2);
  const r = await sincronizar(RAIZ, { forzar: argv.includes("--forzar"), soloEstado: argv.includes("--estado") });
  const donde = r.dir ? path.join(path.relative(RAIZ, r.dir) || ".", "index.html") : "";
  const dicho = {
    apagado: "panel: apagado (`panel.enabled: false`).",
    "al-dia": `panel al día (firma ${r.firma}) · ${donde}`,
    pendiente: `panel DESACTUALIZADO (firma ${r.firma}, sellada ${r.firmaVieja ?? "ninguna"}) — node scripts/panel/sincronizar.mjs`,
    "en-curso": "ya hay una regeneración en curso",
    regenerado: `panel regenerado · versión ${r.version} · ${donde}`,
    error: `no se pudo regenerar el panel: ${r.error}`,
  };
  console.log(dicho[r.accion] ?? r.accion);
  if (r.accion === "error") process.exit(1);
}

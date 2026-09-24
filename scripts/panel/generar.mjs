#!/usr/bin/env node
/**
 * Genera el panel del arnés: la salud del arnés (mapa, frenos instalados, hooks, controles fuera
 * del gate), la memoria del repo (STATUS, incidentes, constitución, config) y la capa EN VIVO de
 * esta máquina (git, registro del gate, sondas, gestor de trabajo, tokens) → un HTML autocontenido
 * y su modelo en JSON.
 *
 * La memoria es determinista y sin IA: mismas fuentes, mismos bytes. Lo corre el gate al final de
 * cada corrida (`scripts/gate.mjs`), así que el panel nunca es más viejo que el último gate; a mano:
 *
 *   node scripts/panel/generar.mjs                 escribe en `panel.out` (default `.git/harness-panel`)
 *   node scripts/panel/generar.mjs --sin-vivo      sólo la memoria (reproducible byte a byte)
 *   node scripts/panel/generar.mjs --salida <dir>  otro destino (CI lo publica como artefacto)
 *   node scripts/panel/generar.mjs --estricto      sale con 1 si el arnés tiene alarmas
 *   node scripts/panel/generar.mjs --verificar     arma y renderiza SIN escribir: el modo para usarlo
 *                                                 como señal del gate (con --estricto), sin pisar el
 *                                                 panel que el gate regenera al final
 *
 * Por qué el destino por defecto está dentro de `.git/`: el arnés no escribe en el árbol de fuentes
 * (P7) —un watcher vivo vería aparecer y desaparecer archivos—, y `.git/` es el único directorio
 * que existe en todo repo, ningún watcher mira y ningún `.gitignore` necesita nombrar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { construirModelo, specDelPanel } from "./leer-fuentes.mjs";
import { renderizarHtml } from "./plantilla.mjs";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const leerJson = (ruta) => {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
};

/**
 * `.git/<algo>` resuelto de verdad. En un worktree `.git` es un ARCHIVO (`gitdir: …`), y
 * `mkdir .git/harness-panel` fallaba ahí con ENOTDIR: el panel desaparecía justo en la forma de
 * trabajar que usan los agentes en paralelo.
 */
export function resolverSalida(raiz, rel) {
  const abs = path.resolve(raiz, rel);
  const partes = path.relative(raiz, abs).split(path.sep);
  if (partes[0] !== ".git") return abs;
  const puntoGit = path.join(raiz, ".git");
  try {
    if (fs.statSync(puntoGit).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(puntoGit, "utf8"));
      if (m) return path.join(path.resolve(raiz, m[1].trim()), ...partes.slice(1));
    }
  } catch {
    /* sin .git: se escribe donde dice, y si no se puede, lo dice el error de escritura */
  }
  return abs;
}

/**
 * Arma el modelo y escribe `index.html` + `modelo.json` en `salida`. `config`/`settings` pueden
 * venir inyectados (el self-test prueba con cebos); `vivo` son las inyecciones de la capa en vivo.
 */
export async function generarPanel(raiz, { salida = null, enVivo = true, config = null, settings = null, vivo = {}, escribir = true } = {}) {
  const cfg = config ?? leerJson(path.join(raiz, ".claude/harness.config.json")) ?? {};
  const spec = specDelPanel(cfg);
  const set = settings ?? leerJson(path.join(raiz, ".claude/settings.json")) ?? {};
  const modelo = construirModelo(raiz, { config: cfg, settings: set });
  if (enVivo && spec.live) {
    // Import perezoso: la capa en vivo trae procesos y red, y quien pide sólo memoria no la carga.
    const { construirEnVivo } = await import("./leer-en-vivo.mjs");
    modelo.enVivo = await construirEnVivo(raiz, modelo, spec, { settings: set, config: cfg, ...vivo });
  }
  const dir = salida ? path.resolve(salida) : resolverSalida(raiz, spec.out);
  const rutaRaiz = path.relative(dir, raiz).split(path.sep).join("/") || ".";
  const escritos = [path.join(dir, "index.html"), path.join(dir, "modelo.json")];
  // Se renderiza SIEMPRE, también sin escribir: lo que `--verificar` prueba es que la página sale.
  const html = renderizarHtml(modelo, { rutaRaiz });
  if (!escribir) return { modelo, escritos: [], dir, bytes: html.length };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(escritos[0], html, "utf8");
  fs.writeFileSync(escritos[1], JSON.stringify(modelo, null, 2) + "\n", "utf8");
  return { modelo, escritos, dir };
}

/** El resumen de una línea por tema que imprimen el gate y el comando. */
export function resumen(modelo, escritos, raiz = RAIZ) {
  const a = modelo.arnes;
  const alarmas = (a?.alarmas.length ?? 0) + modelo.advertencias.length;
  const v = modelo.enVivo;
  const lineas = [
    `Panel del arnés · ${modelo.proyecto.nombre} · versión ${modelo.version}${v ? ` · en vivo al ${v.generadoEn.slice(0, 16).replace("T", " ")}` : " · sólo memoria"}`,
    `  salud: ${alarmas ? `${alarmas} alarma(s)` : "sin alarmas"}${a?.mapa ? ` · ${a.mapa.totales.piezas} piezas en el mapa, ${a.mapa.huecos.length} etapa(s) sin control` : ""} · ${modelo.gotchas.length} gotchas · ${modelo.reglas.gate.signals.length} señales`,
  ];
  if (v?.gate.registro) lineas.push(`  último gate en esta máquina: ${v.gate.registro.veredicto} (${v.gate.registro.fecha.slice(0, 16).replace("T", " ")})`);
  for (const x of a?.alarmas ?? []) lineas.push(`  ⚠ ${x.que}`);
  for (const x of modelo.advertencias) lineas.push(`  ⚠ ${x.que}`);
  const abrir = escritos.length ? path.relative(raiz, escritos[0]).split(path.sep).join("/") : "";
  lineas.push(escritos.length ? `  → ${abrir.startsWith("..") ? escritos[0] : abrir}` : "  (verificado sin escribir: --verificar)");
  return { lineas, alarmas };
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--salida");
  const cfg = leerJson(path.join(RAIZ, ".claude/harness.config.json")) ?? {};
  if (!specDelPanel(cfg).enabled) {
    console.log("panel: apagado (`panel.enabled: false` en el config).");
    process.exit(0);
  }
  const estricto = argv.includes("--estricto");
  let generado;
  try {
    generado = await generarPanel(RAIZ, { salida: i !== -1 ? argv[i + 1] : null, enVivo: !argv.includes("--sin-vivo"), config: cfg, escribir: !argv.includes("--verificar") });
  } catch (e) {
    // Falla abierto: un panel roto no pone rojo a CI ni a nadie —es un sensor para mirar—, salvo
    // que se lo haya pedido como señal. Que genere lo verifica el self-test (sección 11).
    console.log(`panel: no se pudo generar (${e?.message ?? e}).`);
    process.exit(estricto ? 1 : 0);
  }
  const { modelo, escritos } = generado;
  const { lineas, alarmas } = resumen(modelo, escritos);
  for (const l of lineas) console.log(l);
  if (estricto && alarmas) {
    console.log(`PANEL ROJO — ${alarmas} alarma(s): cada una nombra el comando que ya la pone en rojo.`);
    process.exit(1);
  }
}

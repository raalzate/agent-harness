#!/usr/bin/env node
/**
 * harness-map — el arnés como sistema de control: cada pieza con su dirección, su tipo y
 * su etapa del ciclo.
 *
 * El marco de guías y sensores (Böckeler, «Harness engineering», martinfowler.com) pide mirar el arnés entero de una
 * vez: ¿qué guía nunca se entera de si sirvió?, ¿qué etapa no tiene ningún control?, ¿cuánto
 * del arnés es inferencial y cuánto computacional? `lint:rules` contesta qué reglas hay; esto
 * contesta DÓNDE actúa cada pieza, y deja a la vista los huecos.
 *
 * Tres ejes:
 *   dirección  guía (antes de decidir) · freno (decidido, no ejecutado) · sensor (después)
 *   tipo       computacional (determinista) · inferencial (un modelo que juzga)
 *   etapa      de la sesión al barrido continuo — la lista la declara `taxonomy.stages`
 *
 * Agnóstico: el script no sabe qué evento del agente es qué. `taxonomy` en el config dice
 * cómo se clasifica cada evento de `.claude/settings.json`, cada hook de git, cada subagente
 * y cada pipeline. Una pieza que la taxonomía no clasifica es ROJO: un control nuevo que
 * nadie ubicó en el mapa es uno del que nadie sabe qué cubre.
 *
 *   node scripts/harness-map.mjs [--config <ruta>] [--settings <ruta>]
 *
 * Exit: 0 = todo clasificado (los huecos se informan, no bloquean: decidir si una etapa
 * vacía importa es de un humano) · 1 = hay piezas sin clasificar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHookCommand } from "../.claude/hooks/harness.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * El mapa como DATO. Lo imprime este script y lo pinta el panel (`scripts/panel/`): una sola
 * clasificación, porque dos serían dos verdades sobre qué cubre cada pieza. Sin `taxonomy`
 * devuelve `null` — el repo no declaró cómo se lee su arnés, y eso no es un mapa vacío.
 */
export function construirMapa({ config, settings, raiz = REPO_ROOT }) {
  const tax = config?.taxonomy;
  if (!tax) return null;
  const abs = (p) => path.join(raiz, p);
  const piezas = [];
  const sinClasificar = [];
  const agregar = (nombre, dir, tipo, etapas) =>
    piezas.push({ nombre, dir, tipo, etapas: Array.isArray(etapas) ? etapas : [etapas] });

  // Hooks del agente: la dirección y la etapa las pone el EVENTO, no el hook.
  for (const [evento, grupos] of Object.entries(settings?.hooks ?? {})) {
    const c = tax.events?.[evento];
    for (const g of grupos ?? [])
      for (const h of g.hooks ?? []) {
        const nombre = parseHookCommand(h.command)?.etiqueta ?? h.command;
        if (!c) sinClasificar.push(`hook \`${nombre}\` en el evento \`${evento}\`: \`taxonomy.events\` no dice qué es ese evento`);
        else agregar(nombre, c.direction, c.kind ?? "computacional", c.stage);
      }
  }

  // Hooks de git: lo que hay en el directorio es lo que corre.
  const dirGit = tax.gitHooksDir ?? ".githooks";
  if (fs.existsSync(abs(dirGit)))
    for (const f of fs.readdirSync(abs(dirGit)).sort()) {
      const c = tax.gitHooks?.[f];
      if (!c) sinClasificar.push(`hook de git \`${dirGit}/${f}\`: \`taxonomy.gitHooks\` no lo ubica`);
      else agregar(`${dirGit}/${f}`, c.direction, c.kind ?? "computacional", c.stage);
    }

  // Señales del gate: un sensor computacional que corre en cada lugar donde corre el gate.
  for (const s of config.gate?.signals ?? []) agregar(`gate · ${s.name}`, "sensor", "computacional", tax.gateStages ?? []);

  // Subagentes: el único lugar donde vive lo inferencial, así que cada uno se declara.
  const dirAgentes = abs(".claude/agents");
  if (fs.existsSync(dirAgentes))
    for (const f of fs.readdirSync(dirAgentes).filter((x) => x.endsWith(".md")).sort()) {
      const nombre = f.replace(/\.md$/, "");
      const c = tax.agents?.[nombre];
      if (!c) sinClasificar.push(`subagente \`${nombre}\`: \`taxonomy.agents\` no lo ubica`);
      else agregar(`agente · ${nombre}`, c.direction, c.kind ?? "inferencial", c.stage);
    }

  // Guías en prosa y pipelines: los declara la taxonomía tal cual.
  for (const [nombre, c] of Object.entries(tax.guides ?? {})) {
    if (nombre.startsWith("$")) continue;
    if (!fs.existsSync(abs(nombre))) sinClasificar.push(`guía \`${nombre}\`: \`taxonomy.guides\` la nombra y no existe`);
    else agregar(nombre, c.direction ?? "guía", c.kind ?? "inferencial", c.stage);
  }
  for (const [nombre, c] of Object.entries(tax.pipelines ?? {})) {
    if (nombre.startsWith("$")) continue;
    if (!fs.existsSync(abs(nombre))) sinClasificar.push(`pipeline \`${nombre}\`: \`taxonomy.pipelines\` lo nombra y no existe`);
    else agregar(nombre, c.direction ?? "sensor", c.kind ?? "computacional", c.stage);
  }

  const etapas = tax.stages ?? [...new Set(piezas.flatMap((p) => p.etapas))];
  const huecos = etapas.filter((e) => !piezas.some((p) => p.etapas.includes(e)));
  const fueraDeLista = [...new Set(piezas.flatMap((p) => p.etapas))].filter((e) => !etapas.includes(e));
  for (const e of fueraDeLista) sinClasificar.push(`la etapa \`${e}\` no está en \`taxonomy.stages\``);
  const cuenta = (campo, valor) => piezas.filter((p) => p[campo] === valor).length;
  const totales = {
    piezas: piezas.length,
    guia: cuenta("dir", "guía"),
    freno: cuenta("dir", "freno"),
    sensor: cuenta("dir", "sensor"),
    computacional: cuenta("tipo", "computacional"),
    inferencial: cuenta("tipo", "inferencial"),
  };
  return { etapas, piezas, huecos, sinClasificar, totales };
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) principal();

function principal() {
  const args = process.argv.slice(2);
  const flag = (n) => {
    const i = args.indexOf(n);
    return i === -1 ? null : (args[i + 1] ?? null);
  };
  const leer = (ruta) => JSON.parse(fs.readFileSync(ruta, "utf8"));
  const abs = (p) => path.join(REPO_ROOT, p);

  let config;
  let settings;
  try {
    config = leer(flag("--config") ? path.resolve(flag("--config")) : abs(".claude/harness.config.json"));
    settings = leer(flag("--settings") ? path.resolve(flag("--settings")) : abs(".claude/settings.json"));
  } catch (e) {
    console.log(`harness-map: OMITIDO — no pude leer el config o los settings (${e.message}).`);
    process.exit(0);
  }

  const mapa = construirMapa({ config, settings });
  if (!mapa) {
    console.log("harness-map: OMITIDO — el repo no declara `taxonomy`.");
    process.exit(0);
  }
  const { etapas, piezas, huecos, sinClasificar, totales } = mapa;

  console.log("Mapa del arnés — dirección · tipo · etapa (sale de `taxonomy` en el config)\n");
  for (const etapa of etapas) {
    const aca = piezas.filter((p) => p.etapas.includes(etapa));
    console.log(`${etapa}`);
    if (!aca.length) console.log("  (ningún control)");
    for (const p of aca) console.log(`  ${p.dir.padEnd(7)} ${p.tipo.padEnd(14)} ${p.nombre}`);
  }

  console.log(
    `\nTotales: ${totales.piezas} pieza(s) · guía ${totales.guia} · freno ${totales.freno} · sensor ${totales.sensor}` +
      ` · computacional ${totales.computacional} · inferencial ${totales.inferencial}`,
  );
  if (huecos.length) console.log(`Huecos (etapas sin control, para que decida un humano): ${huecos.join(" · ")}`);

  if (sinClasificar.length) {
    console.error("\nSIN CLASIFICAR — piezas del arnés que nadie ubicó en el mapa:");
    for (const s of sinClasificar) console.error(`  ✗ ${s}`);
    console.error("\nUn control que nadie ubicó es uno del que nadie sabe qué cubre. Declaralo en `taxonomy`.");
    process.exit(1);
  }
  console.log("\nMAPA COMPLETO — cada pieza tiene dirección, tipo y etapa.");
}

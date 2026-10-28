#!/usr/bin/env node
/**
 * deploy — el único camino por el que el agente despliega, a cualquier nube.
 *
 * No sabe de AWS, Azure, GCP, Kubernetes, Railway ni Vercel: cada destino de
 * `deploy.targets` declara su comando (array, sin shell: nada que interpolar ni inyectar) y lo
 * que tiene que ser cierto antes de correrlo. Lo que este script agrega es lo que ningún CLI de
 * nube hace por su cuenta: verificar que lo que se despliega es lo que pasó el gate.
 *
 * Uso:
 *   node scripts/deploy.mjs                       # destinos declarados
 *   node scripts/deploy.mjs <destino>             # DRY-RUN: plan + precondiciones, no ejecuta (P9)
 *   node scripts/deploy.mjs <destino> --apply     # verifica y ejecuta
 *
 * No acepta `--config`: el config es SIEMPRE el del repo donde vive el script. Con `--config` el
 * agente podía escribir un archivo propio y hacer correr su comando por el camino autorizado (lo
 * cazó el reviewer, con PoC). El self-test copia el script a un repo temporal, como al hook.
 *
 * Precondiciones (`requires`; sin la clave rigen todas, que es el lado seguro):
 *   cleanTree  nada sin commitear ni suelto: lo que se sube es un commit, no tu árbol de trabajo
 *   branch     se despliega desde `branch` del destino
 *   synced     HEAD == <remote>/<branch> tras un fetch: lo desplegado es lo que vio el equipo
 *   gate       el último gate COMPLETO de esta máquina salió verde sobre este HEAD
 *   env        las variables de `env` existen (se nombran, nunca se imprime un valor)
 * Y una que no se puede sacar: el config está commiteado y sin cambios. El hook autoriza según
 * el config del disco; sin esto, un `approval: "agent"` que el agente se pusiera a sí mismo
 * (o un `planCommand` cambiado) se ejecutaría sin que nadie lo revise en un PR.
 *
 * Cada `--apply` deja una línea en `deploy.ledger` (default `.git/harness-deploys.log`, fuera
 * del árbol, P7): quién, qué commit, a dónde, con qué resultado.
 *
 * Exit: 0 = desplegado o plan listo · 1 = precondición o comando falló.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existeEjecutable, resolverEjecutable, rutaDeEstado, REPO_ROOT } from "../.claude/hooks/harness.mjs";

const args = process.argv.slice(2);
const RUTA_CONFIG_REL = ".claude/harness.config.json";
const rutaConfig = path.join(REPO_ROOT, RUTA_CONFIG_REL);
const posicionales = args.filter((a) => !a.startsWith("--"));
const aplicar = args.includes("--apply");
const desconocidas = args.filter((a) => a.startsWith("--") && a !== "--apply");
if (desconocidas.length) {
  console.error(`deploy: bandera desconocida ${desconocidas.join(", ")}. La única es \`--apply\`.`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(rutaConfig, "utf8"));
} catch {
  console.error("deploy: no hay config legible en .claude/harness.config.json: sin destinos declarados no se despliega nada.");
  process.exit(1); // acá fallar cerrado es lo correcto: un despliegue sin reglas no es un despliegue seguro
}
const spec = config.deploy ?? {};
const destinos = spec.targets ?? {};

function git(...cmd) {
  const r = spawnSync("git", cmd, { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

const nombre = posicionales[0];
if (!nombre) {
  const filas = Object.entries(destinos);
  console.log(filas.length ? "deploy — destinos declarados en `deploy.targets`:\n" : "deploy — `deploy.targets` está vacío: este repo no declara a dónde desplegar.");
  for (const [n, t] of filas) console.log(`  ${n.padEnd(14)} ${(t.approval ?? "human").padEnd(6)} ${t.description ?? (t.command ?? []).join(" ")}`);
  process.exit(0);
}
const target = destinos[nombre];
if (!target) {
  console.error(`deploy: \`${nombre}\` no está en \`deploy.targets\` (${Object.keys(destinos).join(", ") || "vacío"}).\nUn destino que nadie declaró no tiene precondiciones: declaralo en el config, no lo despliegues a mano.`);
  process.exit(1);
}
if (!Array.isArray(target.command) || !target.command.length) {
  console.error(`deploy: \`${nombre}\` no declara \`command\` (array). Sin comando no hay nada que ejecutar.`);
  process.exit(1);
}

const TODAS = ["cleanTree", "branch", "synced", "gate", "env"];
const requiere = new Set(target.requires ?? TODAS);
const remoto = target.remote ?? spec.remote ?? "origin";
const head = git("rev-parse", "HEAD");
const rama = git("rev-parse", "--abbrev-ref", "HEAD");

/** Cada precondición: [nombre, ok, detalle, cómo arreglarla]. */
const chequeos = [];
{
  // Obligatoria: no está en `requires` porque sacarla sería, justamente, lo que hay que impedir.
  const versionado = git("ls-files", "--error-unmatch", RUTA_CONFIG_REL) !== "";
  const cambios = git("status", "--porcelain", "--", RUTA_CONFIG_REL);
  chequeos.push(["config commiteado y sin cambios", versionado && !cambios, !versionado ? "no está versionado" : cambios ? "tiene cambios sin commitear" : "", "commiteá el cambio del config y que pase por PR: quién despliega qué lo decide el equipo, no el turno"]);
}
if (requiere.has("cleanTree")) {
  // Sin ignorar los no rastreados: muchos CLIs suben el DIRECTORIO, no el commit.
  const sucio = git("status", "--porcelain").split("\n").filter(Boolean);
  // El estado (`XY`) se saca con un regex y no con `slice(3)`: `git()` recorta la salida, y en
  // la primera línea de un modificado (« M app.txt») el espacio inicial ya no está — el nombre
  // perdía su primera letra («pp.txt»). Lo cazó el taller.
  const nombreDe = (l) => l.replace(/^\s*\S{1,2}\s+/, "");
  chequeos.push(["árbol limpio", !sucio.length, sucio.length ? `${sucio.length} archivo(s): ${sucio.slice(0, 3).map(nombreDe).join(", ")}${sucio.length > 3 ? ", …" : ""}` : "", "commiteá o descartá; lo que se despliega es un commit"]);
}
if (requiere.has("branch") && target.branch) {
  chequeos.push([`rama \`${target.branch}\``, rama === target.branch, `estás en \`${rama}\``, `\`git switch ${target.branch}\`: a \`${nombre}\` se despliega desde ahí`]);
}
if (requiere.has("synced")) {
  const base = target.branch ?? rama;
  const bajo = spawnSync("git", ["fetch", "--quiet", remoto, base], { cwd: REPO_ROOT, encoding: "utf8" }).status === 0;
  const remota = git("rev-parse", "--verify", "--quiet", `${remoto}/${base}`);
  const ok = Boolean(bajo && remota && remota === head);
  const detalle = !bajo ? `no se pudo bajar \`${remoto}/${base}\`` : !remota ? `no existe \`${remoto}/${base}\`` : `HEAD ${head.slice(0, 7)} ≠ \`${remoto}/${base}\` ${remota.slice(0, 7)}`;
  chequeos.push([`al día con \`${remoto}/${base}\``, ok, ok ? "" : detalle, `\`git pull --ff-only\`: lo desplegado tiene que ser lo que está en \`${remoto}\``]);
}
if (requiere.has("gate")) {
  const rel = config.gate?.registry ?? ".git/harness-gate.json";
  let reg = null;
  try {
    reg = JSON.parse(fs.readFileSync(rutaDeEstado(rel), "utf8"));
  } catch {
    reg = null;
  }
  const marcador = config.gate?.marker && fs.existsSync(path.join(REPO_ROOT, config.gate.marker));
  const ok = Boolean(reg && reg.veredicto === "verde" && reg.modo !== "fast" && reg.head && head.startsWith(reg.head) && !marcador);
  const detalle = !reg ? "nunca corrió en esta máquina" : reg.veredicto !== "verde" ? `último gate: ${reg.veredicto}` : reg.modo === "fast" ? "el último fue `gate:fast`, no es entregable" : !head.startsWith(reg.head ?? "-") ? `el gate verde fue sobre ${reg.head}, no sobre HEAD ${head.slice(0, 7)}` : "hay ediciones posteriores al gate";
  chequeos.push(["gate verde sobre este HEAD", ok, ok ? "" : detalle, `\`${config.gate?.command ?? "node scripts/gate.mjs"}\``]);
}
if (requiere.has("env")) {
  const faltan = (target.env ?? []).filter((v) => !process.env[v]);
  chequeos.push(["variables de entorno", !faltan.length, faltan.length ? `faltan: ${faltan.join(", ")}` : "", "exportalas en tu shell o en el secreto del CI; nunca en el repo ni en el config"]);
}

// En Windows, SÓLO un `.cmd`/`.bat` corre por `cmd.exe` (Node no lo lanza sin shell). Todo lo
// demás va sin shell, igual que el gate: con `shell: true` para todo, cmd.exe partía cualquier
// argumento con espacios (un `node -e "…"` llegaba roto) — lo destapó la matriz de CI. Por
// cmd.exe, `& | < > ^ % !` y las comillas se interpretan: ahí, y sólo ahí, se rechazan.
const META_CMD = /[&|<>^%!"\r\n]/;
const enWindows = process.platform === "win32";
const porCmd = (bin) => enWindows && /\.(cmd|bat)$/i.test(resolverEjecutable(String(bin ?? "")));
/** Lanza un comando del config: sin shell, salvo el `.cmd`/`.bat` de Windows que no hay otra forma. */
const lanzar = (bin, args, opts) => {
  const shell = porCmd(bin);
  return spawnSync(shell ? bin : resolverEjecutable(bin), args, { ...opts, shell });
};
for (const [campo, lista] of [["command", target.command], ["planCommand", target.planCommand ?? []]]) {
  const malos = porCmd(lista[0]) ? lista.filter((a) => META_CMD.test(String(a))) : [];
  if (malos.length) chequeos.push([`\`${campo}\` sin metacaracteres de cmd.exe`, false, malos.join(" "), "pasalo a un script del repo y que el comando sea ese script"]);
}

const fallan = chequeos.filter(([, ok]) => !ok);
const cmd = target.command;
console.log(`deploy → ${nombre}${target.description ? ` (${target.description})` : ""}`);
console.log(`  commit     ${head.slice(0, 7)} en \`${rama}\``);
console.log(`  comando    ${cmd.join(" ")}`);
console.log(`  aprobación ${target.approval ?? "human"}`);
for (const [n, ok, detalle] of chequeos) console.log(`  ${ok ? "✓" : "✗"} ${n}${detalle ? ` — ${detalle}` : ""}`);

if (!aplicar) {
  if ((target.planCommand ?? []).length && !fallan.length) {
    // El plan del propio proveedor (`terraform plan`, `kubectl diff`…): de sólo lectura por contrato.
    console.log(`\nplan del proveedor: ${target.planCommand.join(" ")}`);
    const [p, ...pArgs] = target.planCommand;
    if (!existeEjecutable(p)) console.log(`  (no encuentro \`${p}\` en el PATH: plan omitido)`);
    else lanzar(p, pArgs, { cwd: REPO_ROOT, stdio: "inherit" });
  }
  console.log(
    fallan.length
      ? `\nDRY-RUN: ${fallan.length} precondición(es) sin cumplir. Con \`--apply\` esto no se ejecuta.`
      : `\nDRY-RUN: todo en orden. Para ejecutar: agregá \`--apply\`.`,
  );
  process.exit(0);
}

if (fallan.length) {
  console.error(
    [
      "",
      `deploy: NO se despliega \`${nombre}\` — ${fallan.length} precondición(es) sin cumplir:`,
      ...fallan.map(([n, , detalle, arreglo]) => `  ✗ ${n}${detalle ? ` (${detalle})` : ""}\n      → ${arreglo}`),
      "",
      ...(spec.reason ? [`Motivo: ${spec.reason}`, ""] : []),
      "Saltarse una precondición no es más rápido: es desplegar algo que nadie verificó.",
    ].join("\n"),
  );
  process.exit(1);
}

const [bin, ...binArgs] = cmd;
if (!existeEjecutable(bin)) {
  console.error(`deploy: no encuentro \`${bin}\` en el PATH. Instalá el CLI del proveedor o corregí \`deploy.targets.${nombre}.command\`.`);
  process.exit(1);
}
const inicio = Date.now();
const r = lanzar(bin, binArgs, { cwd: REPO_ROOT, stdio: "inherit", timeout: target.timeoutMs ?? 1800000 });
const estado = r.status === 0 ? "ok" : `falló (exit ${r.status ?? r.error?.code ?? "?"})`;

// El registro vive en `.git/` (P7: nada nuevo en el árbol de fuentes). Una ruta afuera se ignora.
const LEDGER_DEFAULT = ".git/harness-deploys.log";
const ledgerRel = /^\.git\/[^\0]+$/.test(spec.ledger ?? "") && !String(spec.ledger).includes("..") ? spec.ledger : LEDGER_DEFAULT;
if (spec.ledger && ledgerRel !== spec.ledger) console.error(`deploy: \`deploy.ledger\` (${spec.ledger}) no está bajo .git/: registro en ${LEDGER_DEFAULT}.`);
const ledger = path.join(REPO_ROOT, ledgerRel);
try {
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  const linea = { fecha: new Date().toISOString(), destino: nombre, commit: head, rama, quien: git("config", "user.email") || "?", estado, ms: Date.now() - inicio };
  fs.appendFileSync(ledger, `${JSON.stringify(linea)}\n`);
} catch (e) {
  console.error(`deploy: no pude escribir el registro (${e.message}). El despliegue ya corrió: anotalo a mano.`);
}

console.log(`\ndeploy → ${nombre}: ${estado}`);
process.exit(r.status === 0 ? 0 : 1);

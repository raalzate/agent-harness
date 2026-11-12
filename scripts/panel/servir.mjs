#!/usr/bin/env node
/**
 * El panel EN VIVO: lo sirve por http en esta máquina y lo mantiene al día solo.
 *
 * Un panel abierto como archivo es una foto: dice «gate verde» de hace una hora y nadie sabe que
 * mira el pasado. Acá un bucle llama a `sincronizar` (que regenera sólo si cambió algo: un archivo
 * editado, una corrida del gate) y, cada tanto, regenera igual para recoger lo que la firma no ve
 * (el diagnóstico de la máquina, el foco recién leído del tablero). La página mira `latido.json`
 * y se recarga sola cuando cambia, sin perder la pestaña.
 *
 *   node scripts/panel/servir.mjs                 http://127.0.0.1:<panel.serve.port> (4477 por defecto)
 *   node scripts/panel/servir.mjs --puerto 5000
 *
 * Escucha sólo en 127.0.0.1: el panel lleva el diff del repo y el nombre de la persona, y no se
 * publica en la red.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { specDelPanel } from "./leer-fuentes.mjs";
import { resolverSalida, RAIZ } from "./generar.mjs";
import { sincronizar } from "./sincronizar.mjs";

const TIPOS = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8" };

const leerJson = (ruta) => {
  try {
    return JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
};

/** Sirve SÓLO los archivos del panel: nada de rutas relativas que salgan de su carpeta. */
export function crearServidor(dir) {
  return http.createServer((req, res) => {
    let pedido;
    try {
      pedido = decodeURIComponent((req.url ?? "/").split("?")[0]);
    } catch {
      // Una URL mal escapada (`/%E0`) lanza: es un pedido inválido, no un motivo para caerse.
      res.writeHead(400).end();
      return;
    }
    const nombre = pedido === "/" ? "index.html" : pedido.replace(/^\/+/, "");
    const ruta = path.resolve(dir, nombre);
    if (path.relative(dir, ruta).startsWith("..") || !TIPOS[path.extname(ruta)]) {
      res.writeHead(404).end();
      return;
    }
    fs.readFile(ruta, (e, cuerpo) => {
      if (e) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": TIPOS[path.extname(ruta)], "cache-control": "no-store" }).end(cuerpo);
    });
  });
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const argv = process.argv.slice(2);
  const config = leerJson(path.join(RAIZ, ".claude/harness.config.json")) ?? {};
  const spec = specDelPanel(config);
  if (!spec.enabled) {
    console.log("panel: apagado (`panel.enabled: false`).");
    process.exit(0);
  }
  const i = argv.indexOf("--puerto");
  const puerto = Number(i !== -1 ? argv[i + 1] : spec.serve.port);
  const dir = resolverSalida(RAIZ, spec.out);

  let ocupado = false;
  let ultimoForzado = 0;
  const ciclo = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      const forzar = Date.now() - ultimoForzado >= spec.serve.forceEveryMs;
      const r = await sincronizar(RAIZ, { forzar });
      if (forzar) ultimoForzado = Date.now();
      if (r.accion === "regenerado") console.log(`${new Date().toLocaleTimeString()} · panel regenerado${forzar ? " (refresco periódico)" : " (hubo cambios)"}`);
      if (r.accion === "error") console.log(`${new Date().toLocaleTimeString()} · no se pudo regenerar: ${r.error}`);
    } finally {
      ocupado = false;
    }
  };

  // EL BARRIDO DE DERIVA (`drift`): lo que se pudre sin que ningún cambio lo rompa depende del
  // reloj, así que no puede ser señal del gate; necesita quien lo corra solo. El arnés no tiene CI
  // propia y este servidor es lo que corre continuo en la máquina: corre `scripts/drift-check.mjs`
  // cada `drift.everyMinutes` y deja el resultado en `drift.out`, que el panel muestra en Salud.
  const deriva = config.drift?.runner === "scripts/panel/servir.mjs" ? config.drift : null;
  if (deriva) {
    const barrer = () => {
      const r = spawnSync(process.execPath, [path.join(RAIZ, "scripts/drift-check.mjs")], { cwd: RAIZ, encoding: "utf8", windowsHide: true, timeout: 120000 });
      const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter(Boolean).slice(-40);
      try {
        fs.writeFileSync(resolverSalida(RAIZ, deriva.out), JSON.stringify({ fecha: new Date().toISOString(), exit: r.status, salida }, null, 2) + "\n");
      } catch (e) {
        console.log(`deriva: no pude escribir ${deriva.out} (${e.message})`);
      }
      console.log(`${new Date().toLocaleTimeString()} · barrido de deriva: ${r.status === 0 ? "sin deriva" : "HAY DERIVA (ver Salud)"}`);
    };
    setInterval(barrer, Math.max(5, Number(deriva.everyMinutes) || 60) * 60000);
    setImmediate(barrer);
  }

  // Escucha ANTES de la primera regeneración: quien abre la URL ve el último panel enseguida y la
  // página se recarga sola cuando llega el nuevo, en vez de un «conexión rechazada».
  setInterval(ciclo, spec.serve.everyMs);
  setImmediate(ciclo);
  crearServidor(dir)
    .listen(puerto, "127.0.0.1", () => console.log(`Panel en vivo → http://127.0.0.1:${puerto}/  (mira cambios cada ${spec.serve.everyMs / 1000}s · Ctrl+C para cortar)`))
    .on("error", (e) => {
      console.log(`panel: no se pudo escuchar en el puerto ${puerto} (${e.code ?? e.message}). Probá con --puerto <otro>.`);
      process.exit(1);
    });
}

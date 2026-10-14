#!/usr/bin/env node
/**
 * PreToolUse Bash|mcp__* — desplegar por UN camino, con el humano donde importa.
 *
 * El problema que resuelve tiene dos caras, y las dos terminan igual (nadie despliega bien):
 *  - Claude Code frena en bloque todo lo que huele a infraestructura, así que el agente no
 *    puede ni desplegar a un entorno de prueba, y el humano aprende a decir «sí» sin leer.
 *  - Cuando pasa, pasa crudo: un `kubectl apply` o un `railway up` desde una rama sucia, sin
 *    gate y sin registro.
 *
 * La salida es un punto de entrada (`deploy.entry` → `scripts/deploy.mjs`) que verifica las
 * precondiciones y deja registro. Este hook decide sobre él y sobre todo lo demás:
 *
 *  - el punto de entrada EXACTO (sin `;`, `&&`, `|`, `$()` ni nada detrás):
 *      · sin `--apply` sólo muestra el plan → se autoriza;
 *      · con `--apply` a un destino `approval: "agent"` → se autoriza (el script verifica);
 *      · con `--apply` a un destino `approval: "human"` o desconocido → pregunta al humano.
 *  - `deploy.bash.deny` / `deploy.mcp.deny` (destruir un entorno entero) → bloquea.
 *  - `deploy.bash.ask` / `deploy.mcp.ask` (desplegar por fuera, leer secretos) → pregunta,
 *    y el motivo nombra el camino seguro.
 *  - lo demás (leer logs, listar servicios) → no opina: decide el permiso normal.
 *
 * Una herramienta MCP que recibe un comando de CLI como texto (`deploy.mcp.commandFields`) se
 * mide además con las reglas de bash: si no, el mismo `aws … delete-stack` pasa por MCP.
 * Puro: no lanza procesos (regla PUREZA), sólo lee el config y el payload.
 */
import { readInput, loadConfig, deny, ask, allow, permitir, firstMatch, esHerramientaMcp } from "./harness.mjs";

const input = await readInput();
const config = loadConfig();
const spec = config?.deploy;
if (!spec) allow();

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const entradas = (spec.entry ?? []).filter((e) => typeof e === "string" && e.trim());
const camino = entradas[0] ? `\`${entradas[0]} <destino>\` (dry-run) y después \`… <destino> --apply\`` : "el punto de entrada de `deploy.entry`";
const destinos = Object.keys(spec.targets ?? {});
// `hint: false` en una regla = no es un despliegue (leer un secreto): el camino seguro no aplica.
const conPista = (regla) => (regla.hint === false ? "" : ` ${pista}`);
const pista = destinos.length
  ? `Camino seguro: ${camino}. Destinos declarados: ${destinos.join(", ")}.`
  : "Camino seguro: declará el destino en `deploy.targets` del config y desplegá por `deploy.entry`.";

/** Comandos de CLI que llegan: el de Bash, o los campos de texto de una herramienta MCP. */
const mcp = esHerramientaMcp(input);
const ti = input?.tool_input ?? {};
const comandos = mcp
  ? (spec.mcp?.commandFields ?? []).map((c) => ti[c]).filter((v) => typeof v === "string" && v.trim())
  : [String(ti.command ?? "")].filter((v) => v.trim());

// 1. El punto de entrada exacto: la forma declarada, un destino y, como mucho, `--apply`.
//    Cualquier otro carácter (`;`, `&`, `|`, `$`, comillas, redirecciones) o bandera saca el
//    comando de la forma y vuelve al camino normal. Dos agujeros que cazó el reviewer, con PoC:
//     - `\s` de JS incluye `\n`, y para bash un salto de línea separa comandos: `… deploy.mjs\nprintenv`
//       salía autorizado. Por eso sólo ASCII imprimible, y los separadores son espacio o tab.
//     - una bandera cualquiera dejaba pasar `--config <archivo-del-agente>` y el script corría
//       el comando que ese archivo declarara. Ahora la única bandera es `--apply`.
//    Y si el comando casa una regla de `bash.deny`/`bash.ask` de `bash-guard`, acá no se autoriza:
//    la seguridad no depende de cómo resuelve Claude Code dos decisiones de hooks distintos.
const imprimible = (c) => /^[\x20-\x7e\t]*$/.test(c);
if (!mcp && entradas.length && comandos[0] && imprimible(comandos[0]) && !firstMatch([...(config.bash?.deny ?? []), ...(config.bash?.ask ?? [])], comandos[0])) {
  const re = new RegExp(`^[ \\t]*(?:${entradas.map((e) => escapar(e.trim()).replace(/\s+/g, "[ \\t]+")).join("|")})[ \\t]+([A-Za-z0-9._-]+)([ \\t]+--apply)?[ \\t]*$`);
  const m = comandos[0].match(re);
  if (m) {
    const destino = m[1];
    const target = spec.targets?.[destino];
    if (!m[2]) permitir(`deploy: plan de \`${destino}\` sin ejecutar nada (dry-run).`, input);
    if (target?.approval === "agent") permitir(`deploy: \`${destino}\` está declarado \`approval: agent\`; el script verifica las precondiciones antes de ejecutar.`, input);
    ask(
      target
        ? `DESPLIEGUE A \`${destino}\`${target.description ? ` (${target.description})` : ""}: el destino pide aprobación humana. ` +
            `Comando: \`${(target.command ?? []).join(" ")}\`. Antes de decir que sí: ¿corrió el dry-run y el plan es el esperado?`
        : `DESPLIEGUE A \`${destino}\`: el destino no está en \`deploy.targets\`, así que nadie declaró qué hace. ${pista}`,
      input,
    );
  }
}

// 2. Reglas por nombre de herramienta MCP.
if (mcp) {
  const nombre = String(input.tool_name);
  const bloqueo = firstMatch(spec.mcp?.deny, nombre);
  if (bloqueo) deny(`HERRAMIENTA BLOQUEADA: \`${nombre}\`\nMotivo: ${bloqueo.reason}\nPedile al humano que lo haga él. No lo reintentes igual.`);
  const pregunta = firstMatch(spec.mcp?.ask, nombre);
  if (pregunta) ask(`CONFIRMACIÓN DEL HUMANO (\`${nombre}\`): ${pregunta.reason}${conPista(pregunta)}`, input);
}

// 3. Reglas de comandos (Bash, o el comando que trae una herramienta MCP).
for (const comando of comandos) {
  const bloqueo = firstMatch(spec.bash?.deny, comando);
  if (bloqueo) {
    deny(
      `COMANDO BLOQUEADO: \`${comando}\`\nMotivo: ${bloqueo.reason}\n` +
        `Destruir un entorno no se hace desde el agente: pedile al humano que lo corra él. No lo reintentes igual.`,
    );
  }
}
for (const comando of comandos) {
  const pregunta = firstMatch(spec.bash?.ask, comando);
  if (pregunta) ask(`CONFIRMACIÓN DEL HUMANO: ${pregunta.reason}${conPista(pregunta)}`, input);
}

allow();

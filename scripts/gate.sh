#!/usr/bin/env bash
# El gate: única definición de "entregable".
#
# Genérico a propósito: este script NO sabe de stacks. Las señales se declaran en
# `.claude/harness.config.json` → `gate.signals`, así que portarlo a un repo de Go,
# Python o Java es editar JSON, no editar bash.
#
#   scripts/gate.sh          todas las señales (entregable)
#   scripts/gate.sh fast     omite las marcadas `fastSkip` (típicamente el build)
#                            → señal de DESARROLLO, no entregable
#
# Lo corren tres actores con el MISMO comando: el humano, el agente (subagente
# `gate-runner`) y CI. Al terminar en verde borra el marcador `gate.marker`, que es
# lo que mira el hook Stop.
#
# Contrato de cada señal en el config:
#   name           lo que se imprime
#   command        array argv (["npm","run","test"]) — sin shell, sin comillas mágicas
#   why            por qué esta señal no la cubre otra (documentación, no se ejecuta)
#   fastSkip       true = se omite en modo fast
#   skipIfMissing  ruta que, si no existe, hace que la señal se reporte OMITIDA en
#                  vez de fallar (herramienta local no instalada, índice ausente en CI).
#                  "Omitido" se imprime SIEMPRE: nunca se confunde con "pasó".
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

MODE="${1:-full}"
CONFIG=".claude/harness.config.json"
FAILED=()
SKIPPED=()
RAN=0

# Separador de campos: US (0x1f), no TAB. `read` con IFS de espacios en blanco COLAPSA
# delimitadores consecutivos, así que un campo vacío (una señal sin `skipIfMissing`)
# corría todos los demás un lugar y el gate omitía todo creyendo que faltaban archivos.
SEP=$'\x1f'

if [ ! -f "$CONFIG" ]; then
  echo "GATE ROJO — falta $CONFIG: el arnés no está configurado."
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "GATE ROJO — node no está instalado (el arnés lo necesita)."; exit 1; }

# Las señales salen del config como líneas separadas por US (0x1f): name · fastSkip · skipIfMissing · argv-json
SIGNALS=$(node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync(".claude/harness.config.json", "utf8"));
const signals = (c.gate && c.gate.signals) || [];
if (!signals.length) { console.error("gate.signals está vacío: el gate no verifica nada."); process.exit(1); }
for (const s of signals) {
  if (!Array.isArray(s.command) || !s.command.length) { console.error(`señal sin command: ${s.name}`); process.exit(1); }
  process.stdout.write([s.name, s.fastSkip ? "1" : "0", s.skipIfMissing || "", JSON.stringify(s.command)].join("\u001f") + "\n");
}
') || { echo "GATE ROJO — config inválido: $CONFIG"; exit 1; }

echo "Gate (modo: $MODE) — $(node -p 'require("./package.json").name' 2>/dev/null || basename "$PWD")"

while IFS="$SEP" read -r NAME FASTSKIP MISSING ARGV; do
  [ -z "$NAME" ] && continue

  if [ "$MODE" = "fast" ] && [ "$FASTSKIP" = "1" ]; then
    echo ""
    echo "──▶ $NAME"
    echo "    – omitida en modo fast"
    SKIPPED+=("$NAME")
    continue
  fi

  if [ -n "$MISSING" ] && [ ! -e "$MISSING" ]; then
    echo ""
    echo "──▶ $NAME"
    echo "    – OMITIDA: no existe \`$MISSING\` (omitido ≠ pasó)"
    SKIPPED+=("$NAME")
    continue
  fi

  echo ""
  echo "──▶ $NAME"
  # El argv se expande sin shell: nada de eval sobre datos del config.
  if node -e '
      const argv = JSON.parse(process.argv[1]);
      const r = require("node:child_process").spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
      process.exit(r.status === null ? 1 : r.status);
    ' "$ARGV"; then
    echo "    ✓ $NAME"
    RAN=$((RAN + 1))
  else
    echo "    ✗ $NAME"
    RAN=$((RAN + 1))
    FAILED+=("$NAME")
  fi
done <<< "$SIGNALS"

echo ""
if [ ${#SKIPPED[@]} -ne 0 ]; then
  echo "Señales omitidas (NO son verde): ${SKIPPED[*]}"
fi

# Un gate donde NO corrió ninguna señal no es verde: es un gate que no existe. Pasó una
# vez (un separador de campos mal elegido omitía todo) y reportó "entregable".
if [ "$RAN" -eq 0 ]; then
  echo "GATE ROJO — ninguna señal llegó a correr: todas quedaron omitidas."
  echo "Revisá \`gate.signals\` en $CONFIG (rutas de \`skipIfMissing\`, \`fastSkip\` de más)."
  exit 1
fi

if [ ${#FAILED[@]} -ne 0 ]; then
  echo "GATE ROJO — señales fallidas: ${FAILED[*]}"
  echo "Leé el error real (archivo, línea, mensaje) antes de reintentar. Presupuesto: 2 intentos sobre el mismo error."
  exit 1
fi

if [ "$MODE" = "fast" ]; then
  echo "GATE FAST VERDE — señal de desarrollo. NO es entregable: faltan las señales lentas."
  exit 0
fi

MARKER=$(node -p 'JSON.parse(require("fs").readFileSync(".claude/harness.config.json","utf8")).gate.marker || ".git/gate-dirty"' 2>/dev/null)
[ -n "$MARKER" ] && rm -f "$MARKER"
echo "GATE VERDE — entregable."

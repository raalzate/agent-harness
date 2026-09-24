---
description: Verifica (o deja instalado) el índice del código — codegraph. Sin índice, el agente lee caro.
argument-hint: "[init]"
allowed-tools: Bash, Read
---

Modo pedido: `$ARGUMENTS` (vacío = verificar; `init` = construirlo acá).

La regla que este comando sostiene: **primero el índice, después abrir archivos**. El detalle está
en `docs/codegraph.md`; la clave del config que lo declara es `graph`.

## Verificar

1. `codegraph status` — ¿existe el índice y está sincronizado? Un `### Pending sync:` nombra los
   archivos y su antigüedad: eso es el índice mintiendo, y es peor que no tenerlo.
2. `npm run gate` reporta la señal **code index (codegraph)**. Si sale **OMITIDA**,
   el índice no está construido: omitido **no** es verde, y esa línea es el recordatorio.

## Instalar (`init`)

Es una instalación de herramienta externa: **mostrá los comandos y pedí confirmación antes de
correrlos**. No los ejecutes por tu cuenta.

El instalador se baja, se lee y **después** se corre: `curl … | sh` ejecuta código remoto sin
revisarlo y `bash-guard` lo bloquea (la regla `COHERENCIA` del lint impide que esta guía lo
vuelva a recomendar).

```bash
curl -fsSL -o /tmp/codegraph-install.sh https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh
less /tmp/codegraph-install.sh      # leelo antes de correrlo
sh /tmp/codegraph-install.sh
codegraph install     # conecta la herramienta a los agentes de esta máquina
codegraph init        # construye el índice de ESTE repo (crea .codegraph/)
```

Después: `.codegraph/` va al `.gitignore` (es derivado y se regenera), y el config ya lo tiene en
`protectedPaths` — el agente no edita un índice.

## Usarlo

| Pregunta | Comando |
|---|---|
| "¿cómo funciona X?" · "¿cómo llega X a Y?" | `codegraph explore "<pregunta>"` |
| "¿qué se rompe si toco esto?" | `codegraph explore "<símbolo>"` → sección de radio de impacto |
| "¿está al día?" | `codegraph status` |
| mirarlo | `codegraph ui` |

## Salida

```
ÍNDICE: presente y sincronizado | pendiente (<n> archivos) | ausente
SEÑAL DEL GATE: verde | OMITIDA
SIGUIENTE PASO: <el comando exacto, o "ninguno">
```

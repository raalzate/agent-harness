# Windows, macOS y Linux: el mismo gate en las tres

Un arnés que sólo corre en la máquina de quien lo escribió no es un arnés: es una preferencia.
Y el modo en que esto falla es siempre el mismo — **no falla**. El freno no se rompe con un error
rojo: simplemente no existe en esa plataforma, y nadie se entera hasta que alguien mergea algo que
debió frenarse.

> **La regla:** el camino de entrada de todo freno es `node`. Los scripts de shell pueden existir,
> pero nunca ser el único camino.

## Qué corre dónde

| Pieza | Intérprete | Windows | Por qué |
|---|---|---|---|
| Hooks del agente (`.claude/hooks/`) | `node` | sí | Claude Code los invoca con `node`, igual en las tres |
| **El gate** (`scripts/gate.mjs`) | `node` | sí | es el entregable: no puede depender de un shell |
| Los scripts del arnés (lint, self-test, link-check, instalador, banco) | `node` | sí | sin dependencias, sin binarios externos |
| `scripts/gate.sh` | `bash` | — | **envoltorio de una línea** que llama a `gate.mjs`, para no romper a quien ya lo invoca |
| Hooks de git (`.githooks/`) | `bash` | sí | los ejecuta el bash que trae **Git for Windows**; git no usa `cmd` para esto |
| `codegraph` | binario propio | sí | tiene instalador de PowerShell además del de shell |

El único punto que pide algo instalado es el de los hooks de git, y ese algo viene con git.

## Lo que se arregló, y cómo se ve cuando falta

| Trampa | Síntoma en Windows | Mecanismo |
|---|---|---|
| El gate era un script de bash | `npm run gate` no corre, o corre sólo desde Git Bash. **El entregable no existe en esa máquina** | el gate es `scripts/gate.mjs` (Node); el `.sh` quedó como envoltorio, y el self-test verifica que delegue en vez de tener una segunda implementación |
| Una señal del gate invocando un intérprete (`["bash", "x.sh"]`) | la señal falla por «no encontré bash», o se saltea | el self-test rechaza toda señal cuyo comando arranque en `bash`, `sh`, `cmd`, `powershell`… |
| Rutas con `\` y con `/` mezcladas | la ruta queda como **un solo segmento** y ninguna regla por ruta caza nada: `protectedPaths` deja de existir | `segmentosDeRuta` parte por los dos separadores, con un caso del self-test que ejercita la plataforma como parámetro y corre desde cualquier máquina |
| `npm` / `npx` / `gradlew` como comando de una señal | Node los rechaza: en Windows son `.cmd`/`.bat` | el gate resuelve el ejecutable real por `PATHEXT` antes de lanzarlo, sin pasar por un shell |
| Exigir el bit de ejecución | NTFS no lo tiene: **rojo que nadie puede arreglar**, y un rojo así enseña a ignorar la señal | el self-test omite ese caso en Windows, con motivo |
| `hooks:install` con `&&` y comillas simples | `cmd.exe` no interpreta comillas simples: el comando que instala los frenos era el que no corría | es `scripts/hooks-install.mjs` |

Cada fila es la misma historia: **el freno no fallaba, desaparecía**. Por eso ninguna se cierra con
un párrafo — todas tienen un caso del self-test o una corrida de CI detrás.

## La prueba: CI en las tres plataformas

«Portable» sin una corrida en Windows es una suposición. El workflow corre el **mismo**
`npm run gate` en una matriz de `ubuntu-latest`, `windows-latest` y `macos-latest`, con
`fail-fast: false` para que una plataforma rota no esconda a las otras dos.

Es la única prueba honesta: el comando que demuestra que el gate corre allá es el gate.

> Si tu forja no tiene agentes de Windows, decilo en el estado del repo como deuda declarada.
> Deuda declarada se administra; la suposición se descubre el día que entra alguien con Windows.

## Al portar el arnés a un repo

1. El `gate.command` del config apunta a `node scripts/gate.mjs` (o al alias del manifiesto).
   Si apunta a `bash …`, el repo quedó atado a una plataforma.
2. Toda señal del gate es un **argv sin shell**: `["npm", "test"]`, no `["bash", "-c", "npm test"]`.
   Lo segundo además interpola datos del config en una línea de comandos.
3. Los hooks de git se instalan con `node scripts/hooks-install.mjs`, que escribe
   `core.hooksPath` sin depender del shell.
4. Si tu equipo agrega un script propio, la pregunta es una: **¿alguien con Windows puede
   correrlo?** Si la respuesta es "con Git Bash sí", no alcanza para un freno: alcanza para una
   herramienta.

## Lo que sigue sin cubrirse

- **Rutas largas y nombres reservados de Windows** (`CON`, `PRN`, `> 260` caracteres): nadie los
  prueba. Aparecen en repos con jerarquías profundas.
- **Finales de línea.** Si alguien configura `core.autocrlf=true`, los scripts de shell llegan con
  CRLF y el bash de git los rechaza con un mensaje que no menciona el problema. La defensa hoy es
  `.gitattributes`, no un comando.
- **PowerShell como shell del agente**: los hooks del agente no dependen del shell, pero
  `bash.deny` describe comandos con sintaxis POSIX. En una sesión que use PowerShell, las mismas
  acciones destructivas se escriben distinto y los patrones no las cazan.

---

Ver también: [cicd.md](cicd.md) (el pipeline en cada forja) y [codegraph.md](codegraph.md) (el
índice, que tiene instalador propio para Windows). La receta completa de portado es el comando
`/harness-port`.

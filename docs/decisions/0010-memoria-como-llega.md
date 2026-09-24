# ADR 0010 — El panel muestra la memoria como LLEGA al agente, y sólo ejecuta lo que el config permite

- **Fecha:** 2026-09-24
- **Estado:** aceptado
- **Relacionado:** [0008](0008-foco.md), [0009](0009-panel-del-arnes.md), [panel.md](../panel.md)

## Contexto

El panel mostraba las FUENTES que el arnés exige (STATUS, gotchas, constitución, config), y las
llamaba «memoria». Pero la memoria del sistema es otra cosa: lo que el agente lee sin que nadie se
lo pida, por qué capa y en qué momento. Eso no se veía, y era justo lo que más cuesta:

- lo que entra en CADA sesión —las guías con sus `@imports`, el índice de la memoria automática,
  las descripciones de skills y subagentes, lo que imprime el hook de sesión— es un costo fijo
  que nadie medía;
- la memoria automática de Claude Code es de UNA máquina, la escribe el agente y nadie verifica
  que siga apuntando a archivos que existen: en el primer repo donde se midió, 11 de 15 entradas
  citaban rutas que no resuelven;
- lo selectivo (el cuerpo de una skill, un documento citado) no cuesta hasta que algo lo dispara,
  y sin mirar el uso real no se sabe qué pieza cara nadie usa.

## Decisión

1. **Una pestaña «Memoria» ordenada por cómo llega**: al arrancar (el costo fijo, en tokens
   aproximados), selectiva (costo al dispararse + usos leídos de las transcripciones), personal
   (la memoria automática de esta máquina) y versionada (los ADR con su estado).
2. **El panel dice lo que midió, no lo que no puede saber.** El total al arrancar es un PISO
   («≥»): el prompt del sistema, las herramientas, MCP y los plugins no se ven desde el repo. Una
   ruta que no resuelve «no resuelve» —no se afirma que la memoria esté vencida—; una skill sin uso
   es «sin uso acá» —puede servir en otro repo o a otro cliente—.
3. **Ejecutar un hook es opt-in** (`panel.memory.runSessionHooks`). Para saber qué inyecta el
   hook de sesión hay que correrlo, y eso es ejecutar código del repo en cada gate: se enciende
   cuando alguien revisó que no escribe estado. Aun así, sólo los de arranque, sólo `node <script>`
   del repo, con el entorno y el stdin que usa Claude Code. Los hooks de PEDIDO no se ejecutan
   nunca (uno puede escribir el marcador de `ask-first`): lo que inyectan se mide desde el config
   (`promptSources`), y lo que no se declara figura «no medido».
4. **Nada del repo en el código.** Qué hook lee qué clave, dónde viven los ADR, su patrón de
   archivo, las palabras de estado, el umbral de «caro» y la ventana son config. Las rutas se
   reconocen por su forma, sin listas de extensiones de un lenguaje.

## Consecuencias

- Lo que depende de la máquina (home, transcripciones, lo que imprime un hook ahora) va en la capa
  en vivo; lo versionado (ADR) sigue en el modelo determinista.
- Es propio de Claude Code: `CLAUDE.md`, `~/.claude` (o `CLAUDE_CONFIG_DIR`), el formato de las
  transcripciones y las 200 líneas de `MEMORY.md`. Otro agente necesitaría sus ubicaciones como
  config.
- Las transcripciones se leen dos veces (tokens y usos). Hoy son ~200 ms; unificarlas es deuda
  declarada, de rendimiento y no de corrección.
- La prueba de vida son los casos 11k del self-test, con home, git, reloj y ejecutor de hooks
  inyectados.

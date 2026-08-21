# Gotchas — lo que ya nos costó horas

Formato fijo: **síntoma observable → causa raíz → regla → mecanismo que la hace fallar**.
Se escribe en el momento en que se paga, no "cuando haya tiempo" (`/lesson <incidente>`).

La línea `Mecanismo:` es obligatoria y la exige el lint (regla INCIDENTE): sin ella la entrada es
prosa que se va a volver a pagar. Si no hay mecanismo, **se escribe así**, con el motivo — un hueco
declarado se puede cerrar; uno tácito, no.

Estos son incidentes reales de construir y portar este arnés. Sirven de ejemplo del formato y,
varios, de advertencia concreta para quien lo instale en su repo.

---

### GOTCHA: escribir la config del arnés dispara el propio arnés

Síntoma: crear `.claude/harness.config.json` con un heredoc del shell muere con
         `COMANDO BLOQUEADO … Motivo: saltarse los hooks de verificación está prohibido`.
Causa:   el archivo de config **contiene** los patrones que él mismo prohíbe. El guard mira la
         línea de comandos completa, y un heredoc mete el contenido del archivo dentro de esa línea.
Regla:   los archivos de config del arnés se escriben con la herramienta de edición del agente,
         nunca por heredoc del shell. Y los patrones sensibles se escriben con una clase de un
         carácter (`--no-ver[i]fy`) para que el archivo no se cace a sí mismo al ser leído.
Mecanismo: el propio `bash-guard.mjs` — el incidente ES el mecanismo funcionando. Queda escrito
         acá porque el mensaje de bloqueo no explica *por qué* apareció al escribir la config.

### GOTCHA: el hook instalado que nunca corre

Síntoma: una herramienta dice "hook instalado", el archivo existe en `.git/hooks/`, y no se ejecuta
         nunca. Ninguna señal falla: simplemente no pasa nada.
Causa:   el repo setea `core.hooksPath=.githooks`, así que git **ignora** `.git/hooks/` por
         completo — que es exactamente donde escriben los instaladores automáticos.
Regla:   todo hook de git vive en `.githooks/` y se versiona. Después de instalar cualquier
         herramienta que "agregue un hook", verificar `git config core.hooksPath`.
Mecanismo: el hook `SessionStart` avisa en cada sesión si `core.hooksPath` no vale `.githooks`.

### GOTCHA: el freno que bloquea de más termina desactivado a mano

Síntoma: alguien comenta una regla del config, o el equipo empieza a pedir excepciones para trabajo
         legítimo. Semanas después el arnés entero tiene fama de estorbo.
Causa:   se probó que la regla **muerde** y no que **no muerde de más**. Un patrón demasiado ancho
         —por ejemplo `console\.log\(` sin excluir los tests— bloquea trabajo correcto.
Regla:   toda regla nueva se valida con dos comandos, no uno: el self-test (¿muerde?) y el lint
         completo del repo (¿el repo sigue pasando?).
Mecanismo: el self-test incluye casos de "deja pasar lo inocente" (un archivo normal, un
         `git status`), y el gate corre el lint sobre el repo entero.

### GOTCHA: el índice derivado que contesta con datos viejos

Síntoma: el agente responde con confianza sobre código que ya se cambió; nada falla.
Causa:   un derivado que el agente consulta (grafo del repo, índice de símbolos, caché) quedó atrás
         del HEAD y **igual contesta**: con menos verdad y sin avisar. Es la peor clase de error
         porque no tiene síntoma.
Regla:   todo derivado que el agente consulte necesita dos señales: **frescura** (¿para qué commit
         está construido?) y **tamaño** (¿se encogió respecto de su línea base?). La frescura se
         mide sellando el sha indexado y comparándolo contra HEAD, no por reloj: medir por tiempo
         da falsos rojos.
Mecanismo: en este repo, ninguno ejecutable — no hay derivados. Queda escrito porque es la trampa
         que más cuesta al portar el arnés a un repo grande, y el config lo prevé (`postCommit`,
         `graph`).

### GOTCHA: el arnés escribiendo temporales dentro del árbol de fuentes

Síntoma: con el servidor de desarrollo vivo, el build muere con `ENOENT` sobre un archivo que nadie
         escribió; el error aparece y desaparece.
Causa:   el self-test creaba archivos temporales dentro del directorio de fuentes para probar los
         frenos del lint. El watcher los veía aparecer y desaparecer a mitad de una compilación.
Regla:   el arnés **no escribe en el árbol de fuentes**. Para probar un freno del lint se le pasa el
         contenido por stdin y la ruta sólo elige las reglas:
         `node scripts/repo-lint.mjs --file <ruta virtual> --stdin`.
Mecanismo: el modo `--stdin` de `scripts/repo-lint.mjs`, y un caso del self-test que falla si
         quedaron archivos temporales en la raíz del repo.

### GOTCHA: el gate verde que no probaba nada

Síntoma: el gate sale verde en un repo recién portado, en dos segundos, y nadie sospecha.
Causa:   `gate.signals` quedó con las tres señales del arnés y ninguna del proyecto. El gate
         verificaba que el arnés funciona, no que el software funciona.
Regla:   un gate recién instalado se prueba al revés: **rompé algo a propósito** (un tipo, un test)
         y confirmá que el gate se pone rojo. Un gate que nunca falló no es un gate, es una
         esperanza.
Mecanismo: `scripts/gate.sh` es rojo si NINGUNA señal llegó a correr (contador `RAN`) — el caso que
         disparó esto: las señales se pasaban al bucle separadas por TAB, `read` con IFS de espacios
         en blanco colapsa delimitadores consecutivos, el campo vacío de `skipIfMissing` corría los
         demás un lugar y las tres señales salían "omitidas"… con veredicto VERDE. Ahora el
         separador es US (0x1f). Que las señales sean las CORRECTAS sigue sin poder verificarlo
         ninguna máquina: es el paso 1 de `docs/portar.md` y lo mira el `reviewer`.

### GOTCHA: la regla de lint que cazaba una palabra del idioma

Síntoma: el lint marcaba `[TODO] un TODO sin issue es deuda invisible` sobre un comentario que
         decía «**TODO** lo específico del repo vive en el config».
Causa:   el patrón era `\b(TODO|FIXME|XXX)\b` y en español «todo» es una palabra corriente. El
         freno mordía trabajo legítimo — que es exactamente cómo un arnés se termina desactivando.
Regla:   un marcador de deuda se reconoce por su **forma**, no por la palabra: exige `:` o `(`
         inmediatamente después (`TODO:` o `TODO(#12)`). Y toda regla nueva se prueba con dos
         comandos: ¿muerde? y ¿el repo sigue pasando?
Mecanismo: la regla `TODO` del config con el patrón `\b(TODO|FIXME|XXX)(:|\((?!#))`, el caso del
         self-test que la ejercita y `node scripts/repo-lint.mjs` sobre el repo entero en el gate.

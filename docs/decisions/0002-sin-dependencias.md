# ADR 0002 — El arnés corre con node y bash, sin dependencias

- **Fecha:** 2026-08-21
- **Estado:** aceptado
- **Relacionado:** [0001](0001-arnes-portable.md) (la especificidad va en un JSON)

## Contexto

El arnés tiene que instalarse en repos de cualquier ecosistema: TypeScript, Python, Go, Java, un
monorepo, un repo de infraestructura sin ningún lenguaje de aplicación. Cada dependencia que
agregue es una negociación con el equipo destino: hay que meterla en *su* manifiesto, en *su*
lockfile, en *su* pipeline de instalación, y explicar por qué el arnés que viene a poner orden
empieza pidiendo cosas.

Hay un segundo costo, menos obvio y más caro: **los hooks corren en el camino crítico del agente**.
Un `PostToolUse` se ejecuta después de *cada* edición. Si arrancar ese hook implica resolver un
árbol de módulos, el costo se paga cientos de veces por sesión y alguien va a terminar desactivando
el hook — que es la peor forma de perder un freno, porque el archivo sigue ahí y parece vivo.

## Decisión

El arnés usa **sólo `node` y `bash`**, y de node sólo su biblioteca estándar (`node:fs`,
`node:path`, `node:child_process`, `node:url`). Ningún `dependencies`, ningún `devDependencies`
propio, ningún paso de instalación: `harness-init` copia archivos y con eso funciona.

Consecuencias directas que se aceptan a conciencia:

- **El lint es regex sobre texto, no AST.** Un parser por lenguaje sería más preciso y cuesta al
  menos una dependencia por lenguaje.
- **El parseo de JSON y de argv se hace a mano.** Sin librería de CLI, sin validador de esquema.
- **La salida es texto plano.** Sin colores, sin tablas, sin spinners.

La contrapartida se declara en el propio config del repo: `forbiddenDeps` lista paquetes de
conveniencia (`chalk`, `commander`, `yargs`, `eslint`, `glob`) para que agregar uno sea gate rojo y
no una decisión distraída de un jueves a la tarde.

## Alternativas consideradas

- **Publicarlo como paquete instalable.** Es la forma normal de distribuir herramientas y permite
  actualizar con un comando. Descartada por dos razones: (1) el valor del arnés está en que el
  equipo **lea y edite** las reglas en el repo donde corren — una caja negra actualizable invita a
  no mirarlas, y un freno que nadie entiende es un freno que se desactiva; (2) impone un ecosistema
  a repos que no lo tienen. Revisable: si aparece un caso de veinte repos que necesitan sincronizar
  mejoras, el camino es un paquete que **vendoriza** los archivos, no que los esconde.
- **Un parser de verdad para el lint** (AST por lenguaje). Más preciso, y elimina los falsos
  positivos de patrones dentro de comentarios o strings. Descartada: multiplica dependencias por
  lenguaje y convierte al arnés en un mantenimiento propio. Cuando la precisión importe de verdad en
  un repo, la señal correcta ya existe y es el linter de ese stack, corriendo como una señal más del
  gate.
- **Escribirlo todo en bash.** Cero runtime, disponible en cualquier máquina Unix. Descartada: el
  contrato de los hooks es JSON por stdin, y parsear JSON en bash sin `jq` es una fuente de errores
  peor que el problema que resuelve. `node` ya está donde hay agentes de código.
- **Escribirlo en Python.** Mismo razonamiento invertido; en repos de frontend/backend JS no hay
  garantía de intérprete, y en Windows el panorama es peor. Ninguna de las dos gana claramente:
  node se eligió por el contrato JSON.

## Consecuencias

- Instalar el arnés en un repo nuevo no toca su manifiesto ni su lockfile. Es lo que hace que el
  paso 0 de `docs/portar.md` sean cinco minutos.
- Cada hook arranca en milisegundos, así que el freno de mayor retorno (lint del archivo tocado en
  cada edición) es viable.
- El lint tiene falsos positivos posibles en comentarios y strings. Están declarados como deuda en
  `STATUS.md`; el mitigante es que cada regla se prueba en las dos direcciones (que muerda y que no
  muerda de más).
- No hay validación de esquema del config. La suple el self-test: cada ruta tiene que resolver y
  cada regex tiene que compilar, y eso es una señal del gate.
- Escribir código del arnés es más verboso que con librerías. Es un costo que paga quien lo mantiene
  —poca gente— para bajar el costo de quien lo instala, que es mucha.

# Caso de estudio — un arnés real, con números

El método de [metodo.md](metodo.md) no se inventó en abstracto: salió de montarlo sobre un producto
concreto y ver qué aguantaba. Este documento es esa evidencia.

**El repo:** [`raalzate/processflow-architect`](https://github.com/raalzate/processflow-architect)
— una aplicación de escritorio (Electron + Next) para modelado de procesos, con inferencia de IA
**local por defecto** corriendo en la máquina del usuario. Es público: todo lo que se afirma acá se
puede verificar ahí.

Se elige como caso porque tiene las tres condiciones que hacen difícil un arnés: **dos runtimes**
(proceso principal y renderer, que fallan distinto), **una restricción de producto que ningún
compilador ve** (la IA local no puede volverse remota por accidente) y **un agente trabajando a
diario** sobre él.

> **Lo que hay que copiar de acá es el método, no las reglas.** Las reglas de este repo hablan de
> WebGPU, de notaciones de diagrama y de llaves de proveedores de IA. En tu repo eso es ruido. Lo
> transferible es *cómo* cada una llegó a existir.

---

## Antes: memoria sin eslabón

El punto de partida es el más común y el más engañoso: el repo **ya tenía** un archivo de
instrucciones para el agente, y **ya tenía** dos señales corriendo en CI (tipos y tests).

Lo que no tenía era ningún eslabón que hiciera **fallar** las reglas escritas: sin hooks del ciclo
del agente, sin pre-commit (el directorio de hooks de git sólo tenía los `.sample`), sin subagentes,
sin un gate único y sin evidencia de qué estaba verificado. El caso de manual de *instalado y
muerto*: reglas en prosa que sólo se cumplen si alguien se acuerda.

## Hoy: los números

| Pieza | Cantidad | Detalle |
|---|---|---|
| Señales del gate | **8** | self-test · link-check · lint · skills sincronizados · artefactos en el gestor · frescura del índice · typecheck · tests con cobertura · build |
| Hooks del ciclo del agente | **9** | ruteo, índice primero, estado al iniciar, rutas protegidas, reuso, comandos, lint por edición, gate al cerrar |
| Hooks de git | **3** | pre-commit, commit-msg (registro), post-commit (reindexado) |
| Reglas del lint propio | **14** | pureza de la capa lógica, fuente única de tipos, invariantes de arranque, `.only(` olvidado, tokens de tema, dependencias vetadas, notas de release, incidentes con mecanismo… |
| Reglas de comandos denegados | **11** | los irreversibles de *este* stack |
| Rutas protegidas | **9** | secretos, lockfile, derivados, dependencias |
| Principios | **12** (11 BLOCKING) | cada uno nombra el comando que lo hace cumplir |
| Incidentes registrados | **17** | 13 con mecanismo ejecutable; **4 declarados sin él**, con el motivo |
| Ítems de trabajo | **144** (140 cerrados) | 7 features SDD · 108 tareas · 18 incidentes espejados · 1 decisión |

Las señales del gate las corren **tres actores con el mismo comando**: la persona, el agente (a
través de un subagente que aísla el log) y CI.

---

## Cuatro mecanismos y el incidente que los creó

### El binario que funcionaba en desarrollo y no empaquetado

*Síntoma:* la IA local andaba en desarrollo y en el instalador no; el renderer no veía la GPU.
*Causa:* la aceleración por hardware viene desactivada en el empaquetado, y los esquemas
privilegiados tienen que registrarse una sola vez y como seguros.
*Mecanismo:* una regla de **invariante** sobre el archivo de arranque — ciertas líneas no pueden
desaparecer, y otra no puede aparecer. Es la clase de error que ningún test unitario ve, porque
sólo existe en el artefacto empaquetado.

### La suite entera apagada por un carácter

*Síntoma:* el gate en verde con la mitad de las pruebas sin correr.
*Causa:* un `.only(` que quedó de una sesión de depuración.
*Mecanismo:* una regla de **patrón** sobre los archivos de test. Cuesta milisegundos y elimina una
clase entera de falso verde — el peor tipo de error, porque el sistema te felicita.

### Los tipos de diagrama cableados en dieciséis archivos

*Síntoma:* agregar un tipo de componente obligaba a tocar archivos repartidos por toda la UI, y
siempre quedaba uno afuera.
*Causa:* el registro existía, pero nadie lo usaba como fuente única.
*Mecanismo:* una regla de **fuente única** con una allowlist de **17 archivos** que es deuda
declarada y **sólo puede achicarse**. La regla no arregla el pasado: bloquea el futuro y deja la
deuda a la vista. Es el patrón más útil para instalar un arnés sobre código que ya existe.

### Cuatro arreglos terminados sin una sola issue

*Síntoma:* una sesión productiva —cuatro correcciones reales, todas verificadas— y ni un ítem de
trabajo abierto. El registro se hizo de memoria al final.
*Causa:* el ruteo de trabajo **informaba** y el criterio del agente decidía. Informar no es un
mecanismo.
*Mecanismo:* un hook de `commit-msg` que exige la referencia del ítem o una declaración firmada con
motivo. Es el mecanismo más reciente y el que mejor muestra la ley 8: la velocidad del agente
convierte en estructural un problema que con una persona sola era anecdótico.

---

## La línea de tiempo importa más que la foto

| Versión de la constitución | Qué cambió |
|---|---|
| 1.0.0 | Primera versión, al montar el arnés |
| 1.1.0 | Un principio pasa de **revisión** a **bloqueante**: apareció la regla de lint y el test que lo hacen cumplir |
| 1.2.0 | Otro principio pasa a bloqueante **en su parte verificable**: exigir que cada incidente declare su mecanismo |

Ese patrón es el método funcionando. Los principios **empiezan** como criterio humano y **suben de
fuerza cuando aparece el mecanismo**, no al revés. Escribir "BLOCKING" en algo que nadie verifica
es la forma más rápida de que el documento entero pierda autoridad.

Y en 1.2.0 hay un matiz que vale copiar: el principio decía *"cada incidente deja infraestructura,
y el mecanismo elegido debe ser el más fuerte disponible"*. Lo segundo sigue siendo juicio. Lo
primero —que el incidente declare **qué** mecanismo quedó— es verificable. Se hizo bloqueante
**sólo la parte verificable**, en vez de esperar a poder verificarlo todo.

---

## Lo que ese repo declara que NO cubre

Un caso de estudio sin esta sección es publicidad. Cuatro huecos, todos escritos en su propio
estado verificado:

- **4 de 17 incidentes no tienen mecanismo ejecutable.** Dos son del entorno de desarrollo (no del
  artefacto) y dos dependen de una librería externa. Están escritos como "ninguno ejecutable", con
  el motivo.
- **La allowlist de deuda tiene 17 archivos.** Baja despacio.
- **El ruteo de trabajo informa, no bloquea.** Nada impide entregar una feature grande sin abrir su
  ítem madre salvo el criterio del agente y la revisión — el freno de registro pide *un* registro,
  no el *correcto*.
- **No hay verificación automatizada de la interfaz.** La capa lógica está cubierta; la UI se
  verifica a mano.

## Qué se llevó este repo de ese caso

Tres cosas, y las tres están acá adentro:

1. **Los frenos ya eran genéricos; las reglas del lint no.** Siete reglas atadas al dominio de ese
   producto resultaron ser cuatro **clases** de regla. Esa observación es el origen de este repo.
2. **Un arnés se degrada por la vía del caso de prueba que nadie escribió.** De ahí que acá el
   self-test **derive sus casos del config**.
3. **La documentación es parte del arnés y envejece igual que el código.** De ahí el link-check, y
   la verificación de que los documentos que enumeran señales las nombren todas.

Para instalar esto en tu repo: [portar.md](portar.md). Para entender por qué cada pieza está donde
está: [metodo.md](metodo.md).

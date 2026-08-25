# El método — ingeniería de arnés en la práctica

`buenas-practicas.md` explica **por qué** existe un arnés y de qué partes se compone.
`portar.md` da la receta para instalar uno. Este documento es lo que queda en el medio: **el
método de trabajo**, las leyes que lo gobiernan, y cómo se sabe si se está aplicando o sólo se
está hablando de él.

Cada ley de acá salió de aplicar el método y ver qué pasaba cuando faltaba. No son opiniones de
diseño: tienen una cicatriz y un mecanismo. La evidencia está en dos lugares —el
[caso de estudio](caso-de-estudio.md) de un producto real, y este repo, que se audita a sí mismo—
y se nombra en cada ley.

---

## El ciclo

El método no es un proyecto con final: es un ciclo que corre cada vez que algo cuesta tiempo.

```
   incidente  ──▶  ¿qué se puede OBSERVAR?  ──▶  mecanismo más fuerte disponible
       ▲                                                      │
       │                                                      ▼
   deuda declarada  ◀──  ¿quedó algo sin cubrir?  ◀──  validar con el gate
```

**1 · Minar el incidente.** Qué se vio (el mensaje exacto), qué lo causó de verdad, cuántos
intentos costó, qué hipótesis fueron falsas. Si el incidente **ya estaba escrito**, el hallazgo es
otro: la regla existía y no frenó nada, así que hace falta un mecanismo *más fuerte*, no otra
entrada de markdown.

**2 · Preguntar qué se puede observar.** Es la pregunta que elige el mecanismo, y se contesta
mirando el sistema de archivos y los comandos, no la intención:

| Lo que una máquina puede observar | Mecanismo |
|---|---|
| un archivo importa lo que no le corresponde | regla de capa |
| un archivo contiene texto que no debería | regla de patrón |
| un literal se cablea fuera de su registro | regla de fuente única |
| un archivo perdió una línea que lo hacía funcionar | invariante |
| una ruta se editó · un comando se ejecutó | hook del ciclo del agente |
| un commit entró sin registro | hook de git |
| un comportamiento cambió | test |
| **nada** (intención, criterio, gusto) | revisión humana + principio REVIEW |

**3 · Codificar en el más fuerte disponible.** El orden es fijo: *test > hook o regla de lint >
comando > markdown*. Markdown es el último recurso, y si se elige, se escribe **por qué** la regla
no es verificable por máquina.

**4 · Validar con el gate.** Verde, la mejora queda. Rojo, se revierte y se documenta el intento
fallido. Sin este paso, "auto-mejora" es el agente reescribiendo sus propias reglas sin control.

**5 · Declarar lo que quedó afuera.** Un hueco escrito se puede cerrar; uno tácito, no.

---

## Las diez leyes

### 1. Una regla sin un comando que la haga fallar es una sugerencia

Es la ley de la que se derivan todas las demás. La consecuencia operativa incomoda: **la mitad de
la documentación de un repo típico no son reglas, son deseos**, y el equipo lo descubre el día que
alguien las incumple sin que pase nada.

*Cómo se ve cuando falta:* convenciones en el README que nadie sigue hace un año.
*Mecanismo:* `/harness-audit` — para cada regla, qué comando falla si se la viola. Las que no
tienen respuesta se listan como **muertas**.

### 2. Toda señal declara qué error atrapa que ninguna otra atrapa

Un gate crece por acumulación y se poda por fastidio: cuando tarda, se saca lo que moleste. Sin un
motivo escrito, lo que se saca es lo último que alguien agregó, no lo que menos vale.

*Cómo se ve cuando falta:* un pipeline con siete pasos que nadie sabe explicar, y del que se
eliminó el único que atrapaba errores de empaquetado.
*Mecanismo:* el campo `why` es obligatorio en cada señal; el self-test rechaza una señal sin él. Y
si el `why` deja de ser cierto, la señal se saca sin culpa.

### 3. Omitido no es verde

Una herramienta que no está instalada, un directorio que no existe, un paso saltado en modo rápido:
todos tienen la misma tentación —tratarlos como éxito— y todos producen la misma mentira.

*Cómo se ve cuando falta:* CI en verde porque el paso que importaba se saltó silenciosamente.
*Mecanismo:* el gate imprime las omisiones **aparte y siempre**, y si ninguna señal llegó a correr,
el veredicto es rojo. Eso último se agregó después de que un gate reportara "entregable" con las
tres señales omitidas.

### 4. Todo freno se prueba en dos direcciones

Que muerda, y que **no muerda de más**. La segunda es la que se olvida y la que decide si el arnés
sobrevive: un freno que bloquea trabajo legítimo se desactiva a mano en una semana, y se lleva
puestos a los frenos que sí servían.

*Cómo se ve cuando falta:* alguien comenta una regla "temporalmente", y seis meses después el
arnés entero tiene fama de estorbo.
*Mecanismo:* el self-test incluye casos de "deja pasar lo inocente", y el gate corre el lint sobre
el repo entero. En este repo lo cazó dos veces: una regla que marcaba la palabra española «todo» y
un patrón de referencia que aceptaba `UTF-8` como número de ticket.

### 5. La especificidad va en datos, no en código

Las rutas, los patrones, los comandos y los nombres propios del proyecto viven en un archivo de
configuración. El código de los frenos no sabe de stacks.

*Cómo se ve cuando falta:* un arnés que funciona perfecto en un repo y es intransferible al
siguiente, porque sus reglas nombran módulos que sólo existen ahí.
*Mecanismo:* portar el arnés es reescribir un archivo. Y lo verifica el self-test, que **deriva sus
casos del config**: una regla nueva queda cubierta sin escribir código.

### 6. El freno se prueba con el eslabón real

No con un doble, no con una simulación del hook: ejecutando el hook con su entrada real, y —cuando
depende de git— en un repositorio git de verdad, temporal.

*Cómo se ve cuando falta:* el anti-patrón central, **instalado y muerto**: archivos presentes cuyo
eslabón activador nunca corre. El caso clásico es un hook escrito en `.git/hooks/` cuando el repo
usa `core.hooksPath`: existe, se ve bien, y git lo ignora.
*Mecanismo:* el self-test ejecuta cada hook con payloads reales y levanta repos git temporales para
los hooks de git.

### 7. Lo que se decide, se declara; lo que se declara, se verifica

Vale para las tres formas de decisión que se pudren en silencio: dónde viven los artefactos, qué
deuda se aceptó, y qué archivos están exentos de una regla.

*Cómo se ve cuando falta:* medio equipo guarda los planes en el repo y medio en el gestor, y nadie
sabe cuál manda; una allowlist que empezó con cinco archivos y hoy tiene cuarenta.
*Mecanismo:* la decisión se escribe en el config y una señal la verifica; las allowlists **sólo
pueden achicarse**, y que crezcan es un hallazgo de revisión que se justifica por escrito.

### 8. El registro es un freno, no una convención

Con un agente el problema cambia de escala porque el agente es rápido: varios cambios pueden estar
terminados antes de que nadie abra un ítem de trabajo, y el registro se hace de memoria al final —
o no se hace.

*Cómo se ve cuando falta:* "¿por qué cambió esto?" seis meses después, y la respuesta es
arqueología del diff.
*Mecanismo:* un hook de `commit-msg` que exige la referencia **o** una declaración firmada con
motivo. Ver [trazabilidad.md](trazabilidad.md). Nació de un incidente real: cuatro arreglos
terminados en una sesión sin una sola issue.

### 9. La memoria del agente es infraestructura

Los documentos que el agente lee no son prosa de acompañamiento: son la entrada de cada turno. Un
puntero roto manda a leer un archivo que no existe y gasta el turno; una lista incompleta lo hace
trabajar con información falsa **sin que nada falle**.

*Cómo se ve cuando falta:* documentación que envejece en silencio — el caso más traicionero,
porque no tiene síntoma.
*Mecanismo:* el link-check verifica que cada puntero resuelva **contra el índice de git** (no
contra el disco: eso deja pasar archivos ignorados, verde local y rojo en CI) y que los documentos
que enumeran señales las nombren todas.

### 10. Cada incidente deja infraestructura

El cierre del ciclo. Un problema que costó tiempo no termina cuando el síntoma desaparece: termina
cuando existe el comando que falla si alguien lo repite.

*Cómo se ve cuando falta:* el mismo error dos veces, con seis meses de diferencia y dos personas
distintas.
*Mecanismo:* el formato del registro de incidentes es fijo —**síntoma · causa · regla ·
mecanismo**— y el lint exige la línea del mecanismo. Si no hay ninguno, se escribe "ninguno
ejecutable" con el motivo: eso es un hueco declarado, no una omisión.

---

## Cómo se mide que el método se está aplicando

No por la cantidad de reglas. Por tres preguntas, en este orden:

1. **¿Cuántas de tus reglas escritas tienen un comando que las hace fallar?** La proporción es el
   nivel de madurez real. `/harness-audit` la calcula.
2. **¿Cuándo fue la última vez que el gate se puso rojo por algo que no era un test?** Si nunca, el
   gate probablemente verifica lo que ya estaba verificado.
3. **¿Cuántos de tus incidentes de los últimos tres meses dejaron un mecanismo?** Los que no, van a
   volver.

Los cuatro niveles de madurez (L0 a L4) y la auditoría completa están en
[buenas-practicas.md](buenas-practicas.md); un arnés real medido con esa vara, en el
[caso de estudio](caso-de-estudio.md).

## Lo que NO es el método

- **No es acumular reglas.** Una regla sin cicatriz es ruido bien intencionado que gasta contexto
  del agente y paciencia del equipo.
- **No es copiar el arnés de otro equipo.** Las reglas concretas describen los incidentes de *un*
  repo. Lo que viaja son los principios y este ciclo.
- **No es un sustituto del criterio.** La intención no es verificable por máquina: por eso existen
  los principios de revisión. Lo que el método logra es que lo verificable **no dependa de que
  alguien se acuerde**.

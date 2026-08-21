# Gotchas — lo que ya nos costó horas

Formato fijo: **síntoma observable → causa raíz → regla → mecanismo que la hace fallar**.
Se escribe en el momento en que se paga, no "cuando haya tiempo" (`/lesson <incidente>`).

La línea `Mecanismo:` es obligatoria y la exige el lint (regla INCIDENTE): sin ella, la entrada es
prosa que se va a volver a pagar. Si el mecanismo es "ninguno ejecutable", **se escribe así**, con
el motivo — un hueco declarado se puede cerrar; uno tácito, no.

Higiene: si un test o un hook ya garantiza la regla, la entrada se recorta a una línea que apunta
al mecanismo. La prosa duplicada sólo gasta contexto.

---

### GOTCHA: <síntoma en una línea, como se ve desde afuera>

Síntoma: <qué se observó: el mensaje exacto, la pantalla en blanco, el proceso que murió>
Causa:   <la causa raíz, no la primera hipótesis>
Regla:   <qué se hace de ahora en más>
Mecanismo: <el comando que ahora falla si alguien lo repite — o "ninguno ejecutable: <por qué>">

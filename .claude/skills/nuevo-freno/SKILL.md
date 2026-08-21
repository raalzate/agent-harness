---
name: nuevo-freno
description: Convierte una regla escrita en prosa en un freno ejecutable de este arnés (regla de config, hook, señal del gate o test), con su caso de self-test y validado por el gate. Úsalo cuando alguien diga "hay que acordarse de…", "la convención es…" o "no volvamos a hacer X".
---

# Nuevo freno

Una regla sin un comando que la haga fallar es una sugerencia. Este skill convierte una
sugerencia en un freno.

## 1. Clasificá la regla

Preguntá **qué observaría una máquina** si alguien la viola. La respuesta elige el mecanismo:

| Lo que se puede observar | Mecanismo | Dónde |
|---|---|---|
| Un archivo importa lo que no debe | `purity` | config |
| Un archivo contiene texto que no debe | `patterns` | config |
| Un literal se cablea fuera de su registro | `singleSource` | config |
| Un archivo perdió una línea que lo hacía funcionar | `invariants` | config |
| Una dependencia entró al manifiesto | `forbiddenDeps` | config |
| Una ruta se editó | `protectedPaths` | config |
| Un comando irreversible se ejecutó | `bash.deny` | config |
| Un comportamiento cambió | test en la suite del proyecto | código |
| Nada observable (intención, criterio, gusto) | `reviewer` + una línea en `CONSTITUTION.md` como **REVIEW** | markdown |

**Empezá siempre por config.** El 80 % de las reglas de un repo caen ahí, y una regla en config
la cubre el self-test automáticamente: no hace falta escribir código nuevo.

## 2. Escribila con su motivo

Cada regla lleva `reason` o `message` que dice **por qué**, no qué. El agente lee ese texto cuando
lo bloqueás: es la única oportunidad de que entienda en vez de reintentar.

Mal: `"no uses eso"`.
Bien: `"las llaves salen sólo del proceso servidor: en el cliente terminan en el bundle público"`.

## 3. Probá que muerde, y que no muerde de más

```bash
npm run selftest    # el caso se genera solo si la regla vive en el config
npm run lint        # el repo entero sigue pasando
```

Dos verificaciones, no una: un freno que bloquea todo se desactiva a mano en una semana.
Si escribiste código nuevo (hook o clase de regla), agregá su caso al self-test a mano.

## 4. Cerrá con el gate y con el registro

```bash
npm run gate
```

Verde → queda. Rojo → se revierte y se documenta el intento fallido.

Si la regla nació de un incidente, la entrada en `docs/gotchas.md` va en formato fijo
(**Síntoma · Causa · Regla · Mecanismo**) y la línea `Mecanismo:` nombra el comando que ahora
falla. El lint lo exige: un gotcha sin mecanismo pone el gate en rojo.

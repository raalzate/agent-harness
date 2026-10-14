# ADR 0013 — La tarea declarada: el agente planifica, el arnés verifica que terminó

- **Fecha:** 2026-10-14
- **Estado:** aceptado
- **Relacionado:** #52, #53 (spec y criterios en el comentario del ítem), #50, [config-reference.md](../config-reference.md) (`task`), [0011](0011-ciclo-acotado.md)

## Contexto

El gate dice si el repo está sano, pero no sabe **qué se pidió**. «Terminé» era entonces la palabra
del agente: nada impedía salirse de la tarea «de paso» ni declarar listo lo que no cumplía el
criterio de aceptación. El modelo XP + Agent Harness pide lo contrario: planificación verificable,
cambios pequeños dentro de un alcance y una verificación que no dependa del propio agente.

## Decisión

1. **Una tarea escrita, de esta sesión de trabajo**: ítem, alcance y criterios, en `.git/` (P7),
   la escribe `scripts/task.mjs`. Es estado, no fuente: no se versiona y no se edita a mano
   (`bash.deny`).
2. **El alcance lo hace cumplir `protected-paths`**: misma pregunta que las rutas protegidas
   (¿esta ruta se puede tocar?) y un hook más sería un arranque de node más en cada edición. Sin
   alcance declarado no se edita: planificar va antes de escribir. Ampliarlo es legítimo, pero con
   motivo, y el motivo queda en el registro de la tarea para que un reviewer lo vea. Todo el repo
   (`**`, `.`) no es un alcance.
3. **«Terminado» lo verifica el gate, no el agente**: cada criterio trae el comando que falla si no
   se cumple, y la señal «task» lo re-ejecuta sin shell. Cruza además contra el alcance TODO lo que
   cambió desde el inicio (commiteado, sin commitear, nuevo, sin detección de renombres): lo
   escrito por Bash, que el hook no ve, también cuenta. Si git no puede calcular el diff, rojo.
4. **La evidencia no es una puerta trasera**: se rechaza la trivial (`trivialEvidence`) y la que
   `bash.deny`/`bash.ask` prohíben, porque la ejecuta el gate sin preguntar.
5. **«No terminé» no es «estoy trabado»**: la señal declara `countsAttempts: false`, así el ciclo
   acotado (ADR 0011) no congela las ediciones por una tarea incompleta que repite su salida.
6. **Lo roto deja pasar**: una tarea que no tiene la forma esperada se ignora (P5). En un worktree
   el estado se resuelve al gitdir real leyendo el archivo `.git`, sin lanzar git.

## Consecuencias

- Con una tarea activa, `STATUS.md`, `docs/gotchas.md` o cualquier documento que se vaya a tocar
  tiene que estar en el alcance: no hay exentos implícitos. Declararlos es parte de planificar.
- Que la evidencia demuestre de verdad el criterio sigue siendo juicio del `reviewer`:
  `trivialEvidence` es una lista negra y no ve un script escrito para pasar. El paso siguiente es
  exigir que la evidencia falle sin el cambio (`cycle-check --verify-red`).
- `bash.deny` protege el archivo de los comandos obvios, no de un `node -e` que lo reescriba: el
  mismo hueco que el ciclo acotado, declarado en `STATUS.md`.

# Instrucciones del agente — <PROYECTO>

@CONSTITUTION.md

---

## El arnés (leer antes de tocar nada)

- **Nada se entrega sin el gate verde.** Es la única definición de entregable:
  `<comando del gate>`. La versión rápida (`<gate fast>`) omite señales lentas: es señal de
  desarrollo, **no** entregable. Una señal omitida no es verde.
- Cómo está montado (hooks, subagentes, comandos, rutas protegidas): `docs/arnes.md`.
- Antes de escribir código: ¿ya existe la abstracción? (`docs/reuse-patterns.md`).
- Trabajo de tamaño feature → ruta SDD (`docs/sdd.md`). Saltarla se **declara** en una línea;
  no se omite en silencio.
- Un incidente que costó tiempo termina en `/lesson`: mecanismo más fuerte disponible
  (test > lint/hook > comando > markdown), validado con el gate.

## Sobre el proyecto

<qué es, para quién, qué restricción manda sobre todas las demás>

## Arquitectura en una frase

<una frase, después el árbol de directorios con una línea por directorio>

## Reglas de desarrollo

- <la regla que más veces se rompió, primero>
- **La lógica pura va en `<capa>`** (sin framework, sin I/O). Es lo único con cobertura exigida.
- <invariantes del dominio que un compilador no ve>

## Antes de dar algo por terminado

```bash
<comando del gate>        # EL entregable
<comando del gate fast>   # señal de desarrollo, no entregable
```

- CI corre **el mismo** gate. No mergear en rojo.
- Pre-commit real: `git config core.hooksPath .githooks`. Saltarse la verificación está prohibido:
  si el gate estorba, se arregla el gate.
- **TDD para `<capa>`:** toda función nueva o cambio de comportamiento lleva prueba. Si un test rojo
  refleja un cambio de comportamiento *intencional*, se actualiza el test (no se debilita el código).

## Estilo

- Código y comentarios siguen el estilo del archivo vecino. Los comentarios explican el **porqué**.
- No agregar dependencias sin necesidad clara.

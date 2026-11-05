# Quién lee cada clave

## Claves del config y los scripts que las leen

| Clave | Lo leen |
|---|---|
| `gate` (`command`, `marker`, `signals`) | `scripts/gate.mjs`, `gate-stop.mjs`, `session-start.mjs`, self-test |
| `gate.codeGlobs`, `gate.codeExtensions` | `post-edit-check.mjs` (¿ensucia el gate y se lintea?), self-test |
| `gate.installHooksCommand` | `session-start.mjs` (el aviso de pre-commit sin instalar), self-test |
| `protectedPaths` | `protected-paths.mjs`, `.githooks/pre-commit`, self-test |
| `writeTools` | `harness.mjs` (`escribe`, `targetPath`, `proposedContent`) → `protected-paths.mjs`, `action-guard.mjs`, `reuse-guard.mjs`, `post-edit-check.mjs`; self-test (3b-bis) |
| `bash.deny` | `bash-guard.mjs`, self-test |
| `bash.ask` | `bash-guard.mjs` (después de `deny`), self-test (3c-bis) |
| `deploy` | `deploy-guard.mjs` (`bash`, `mcp`, `entry`, `targets.*.approval`), `scripts/deploy.mjs` (`targets`, `ledger`, `remote`, `reason`; y `gate.registry`/`gate.marker` para la precondición `gate`), self-test (3c-ter, 3c-quater) |
| `reuse` | `reuse-guard.mjs`, self-test |
| `lint` (incluye `sourceExtensions`) | `post-edit-check.mjs`, `scripts/repo-lint.mjs`, `.githooks/pre-commit`, self-test |
| `purity`, `purityImportSyntax`, `forbiddenDeps`, `singleSource`, `invariants`, `patterns`, `tests`, `incidents` | `scripts/repo-lint.mjs`, self-test |
| `profiles` | `scripts/repo-lint.mjs` (regla `PERFIL`), self-test |
| `examples`, `install` | self-test (sección 8): forma de cada ejemplo, y sus reglas `forbiddenDeps`/`purity` corridas con `--config` + stdin (ruteo y anchura) |
| `docs` | `scripts/docs-linkcheck.mjs`, `scripts/repo-lint.mjs` (directorios a saltear) |
| `status` (incluye `reminder`) | `session-start.mjs`, self-test |
| `status.events` (y `incidents`, `gate.command`, `panel.status.fields`, `docs.ignoreMarker`) | `scripts/status.mjs` (señal «status ledger», `/bitacora`), `scripts/gate.mjs` (`journal`, `heartbeatDays`), `session-start.mjs` (`journal`: eventos pendientes), self-test (3g-ledger) |
| `tracker` | `.githooks/commit-msg`, `scripts/artifacts-check.mjs`, self-test |
| `commitMsg` | `.githooks/commit-msg`, self-test |
| `sdd` | `sdd-router.mjs`, self-test |
| `askFirst` | `ask-first.mjs`, `action-guard.mjs`, self-test |
| `task` | `scripts/task.mjs` (la escribe, la verifica: la señal «task» del gate), `protected-paths.mjs` (frena fuera del alcance, vía `tareaActiva`/`dentroDelAlcance` de `harness.mjs`; frena editar una prueba congelada, vía `pruebasBloqueadas`; deja escribir la lista de tareas, vía `rutaDeTodo`), `bash.deny` (no se reescribe a mano), self-test (3e-tarea). `todoFile`/`todoOpenPattern` y `lockTests` los leen `task.mjs` (`verify`, `lock`, `unlock`) y `protected-paths.mjs`; `lockTests.pattern` vacío cae en `xp.testFirst.testPattern`; `todoFile` también lo lee `scripts/artifacts-check.mjs` (la lista no es un artefacto suelto, self-test 3g) |
| `coder` | `scripts/coder-spawn.mjs` (con `workflow.branchPattern`/`baseBranch` y `subagentOutput.contracts.coder`), `/code` (la vía «como sesión propia»), self-test (3g-coder) |
| `worktrees` | `scripts/worktree-check.mjs` (la señal «worktrees out of sight»; usa `workflow.baseBranch` para los huérfanos), self-test (3g-wt) |
| `loop` | `scripts/gate.mjs` (cuenta y deja el marcador), `action-guard.mjs` (frena editar), `gate-stop.mjs` (deja cerrar), `ask-first.mjs` (repone), `scripts/hooks-timing.mjs` (estado a restaurar), self-test (3e-loop) |
| `branches` | `.githooks/pre-push`, self-test |
| `branches.serverProtection` | `scripts/drift-check.mjs` (sección 3, lo corre `drift.yml`), self-test (10a) |
| `workflow` | `scripts/cycle-check.mjs` (lo invoca `.githooks/pre-push`), la ruta `cycle` del router, self-test |
| `workflow.sync` | `scripts/cycle-check.mjs` (`--push` desde `.githooks/pre-push`, y `--sync` = `npm run sync`), `session-start.mjs` (aviso sin red), self-test (3f-ter-bis) |
| `xp` | `scripts/cycle-check.mjs` (lo invoca `.githooks/commit-msg`), self-test (una práctica por cebo) |
| `preCommit.extra` | `.githooks/pre-commit` (después de rutas protegidas y lint), self-test (3f-quater) |
| `postCommit` | `.githooks/post-commit` |
| `graph` | `graph-first.mjs`, la señal `índice del código` del gate, self-test (sus regex compilan) |
| `observability` | `scripts/hooks-timing.mjs` (la señal `costo del arnés` del gate), `scripts/reviewer-eval.mjs` (`stateFiles`: la foto de la sesión), self-test (secciones 9 y 10) |
| `xp.testFirst.verifyRed` | `scripts/cycle-check.mjs`, modo `--verify-red` (lo invoca `.github/workflows/ci.yml` en el PR), self-test (3f-ter) |
| `coherence` | `scripts/repo-lint.mjs` (regla `COHERENCIA`), self-test (4e-bis) |
| `drift` (y `status.file`, `patterns`, `reuse`) | `scripts/drift-check.mjs` (lo invoca `.github/workflows/drift.yml`), self-test (10a) |
| `reviewerEval` | `scripts/reviewer-eval.mjs` (lo invoca `.github/workflows/drift.yml`), `scripts/ai-eval.mjs` (la suite con `casesFrom`), self-test (10b) |
| `aiEval` | `scripts/ai-eval.mjs` (a mano, `npm run eval:ai`) y `scripts/eval/ai-provider.mjs` (por el config que genera), self-test (10f) |
| `harnessEval` | `scripts/harness-eval.mjs` (la señal `harness eval (deterministic)` del gate), self-test (10e) |
| `ci.investigate` (y `gate.registry`) | `scripts/ci-investigate.mjs` (lo corre el subagente `ci-investigator` y `/ci`), self-test (2: sus regex; 10d: la máquina con un CLI de mentira) |
| `library` (y `protectedPaths`, que `migrate` respeta; `library.agent` y `library.route` los lee además `graph-first.mjs`) | `scripts/library.mjs` (la señal `library index (docs)` del gate; lo corre el subagente `librarian` y los skills `library-index` / `library-migrate`), self-test (12) |
| `subagentOutput` | `subagent-contract.mjs` (SubagentStop), `scripts/ai-eval.mjs` (el veredicto de cada suite), self-test (3e-sub, 10f) |
| `taxonomy` (y `taxonomy.graphFile`, que escribe `harness-map.mjs --graph`) | `scripts/harness-map.mjs`, el panel (pestaña Salud, misma función `construirMapa`), self-test (10c) |
| `panel` (y `status`, `incidents`, `tracker`, `tests`, `docs.proseRoots`, `install.activators`, toda clave con `runner`; `panel.memory.promptSources` apunta a otras, como `sdd.routes`) | `scripts/panel/` (lo invoca `scripts/gate.mjs` al final de cada corrida), self-test (11) |
| `gate.registry` | `scripts/gate.mjs` (lo escribe), `scripts/panel/leer-en-vivo.mjs` y `scripts/ci-investigate.mjs` (lo leen) |

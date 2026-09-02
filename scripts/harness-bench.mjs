#!/usr/bin/env node
/**
 * Banco de perfiles — el arnés instalado en un repo REAL de cada stack.
 *
 *   node scripts/harness-bench.mjs                 # todos los stacks, sin el gate del destino
 *   node scripts/harness-bench.mjs --con-gate      # además corre el gate del repo portado (lento)
 *   node scripts/harness-bench.mjs --solo=dotnet   # un stack
 *   node scripts/harness-bench.mjs --conservar     # deja los repos temporales para inspeccionar
 *
 * El self-test verifica la FORMA de un perfil (que traiga sus claves, que no lleve reglas
 * ajenas). Esto verifica el ENCAJE, que es lo que el self-test no puede: que el `matcher` de
 * DEPS case el XML real de un `.csproj`, que `purityImportSyntax` cace un `using` real, que
 * `tests.filePattern` reconozca el layout real, y que los hooks muerdan sobre archivos reales
 * del lenguaje.
 *
 * Existe porque esa deuda se pagó dos veces en una sola corrida: el caso de PUREZA del
 * self-test daba FALSO ROJO en todo repo que no fuera JS (cableaba `import x from "mod"`), y el
 * arnés recién instalado citaba documentos que el instalador no copiaba, así que el link-check
 * del repo portado salía rojo el primer día.
 *
 * Cada stack vive en su propio repo git temporal fuera de este repo: no escribe nada acá (P7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { fileURLToPath } from "node:url";

const ARNES = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CONSERVAR = process.argv.includes("--conservar");
const SOLO = process.argv.find((a) => a.startsWith("--solo="))?.split("=")[1];
// El gate del repo portado corre su propio self-test completo: son ~8s por stack, así que en
// el gate de este repo se omite y queda para CI y para el uso a mano.
const CON_GATE = process.argv.includes("--con-gate");

/**
 * Un repo de juguete por stack, con archivos REALES del stack (no plantillas del arnés):
 *   manifiesto     el manifiesto de dependencias, con una dependencia que se va a vetar
 *   veta           el nombre de la dependencia tal como se escribe en `forbiddenDeps.packages`
 *   fuente         un archivo de dominio que importa el framework prohibido
 *   importa        el módulo prohibido (la sintaxis de import es la del stack)
 *   test           un archivo de test en el layout real del stack
 *   derivado       un archivo dentro de un directorio derivado (tiene que estar protegido)
 *   capa           el directorio de la capa pura
 */
const FIXTURES = {
  dotnet: {
    manifiesto: "Directory.Packages.props",
    archivos: {
      "Directory.Packages.props": `<Project>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="3.1.1" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>
`,
      "src/Api/Api.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>
`,
      "src/Domain/Order.cs": `using System;
using Microsoft.EntityFrameworkCore;

namespace Tienda.Domain;

public sealed record Order(Guid Id, decimal Total);
`,
      "tests/Domain.Tests/OrderTests.cs": "public class OrderTests { }\n",
      "bin/Debug/net8.0/Api.dll": "binario\n",
      "obj/project.assets.json": "{}\n",
    },
    veta: "Newtonsoft.Json",
    fuente: "src/Domain/Order.cs",
    importa: "Microsoft.EntityFrameworkCore",
    test: "tests/Domain.Tests/OrderTests.cs",
    derivado: "obj/project.assets.json",
    capa: "src/Domain",
  },
  "jvm-maven": {
    manifiesto: "pom.xml",
    archivos: {
      "pom.xml": `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.ejemplo</groupId>
  <artifactId>tienda</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
    </dependency>
  </dependencies>
</project>
`,
      "src/main/java/com/ejemplo/domain/Order.java": `package com.ejemplo.domain;

import org.springframework.stereotype.Service;

public record Order(String id, long total) { }
`,
      "src/test/java/com/ejemplo/domain/OrderTest.java": "class OrderTest { }\n",
      "target/classes/Order.class": "binario\n",
    },
    veta: "junit",
    fuente: "src/main/java/com/ejemplo/domain/Order.java",
    importa: "org.springframework",
    test: "src/test/java/com/ejemplo/domain/OrderTest.java",
    derivado: "target/classes/Order.class",
    capa: "src/main/java/com/ejemplo/domain",
  },
  "jvm-gradle": {
    manifiesto: "build.gradle.kts",
    archivos: {
      "build.gradle.kts": `plugins { kotlin("jvm") version "1.9.22" }

dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    testImplementation(kotlin("test"))
}
`,
      "settings.gradle.kts": `rootProject.name = "tienda"\n`,
      "src/main/kotlin/com/ejemplo/domain/Order.kt": `package com.ejemplo.domain

import org.springframework.stereotype.Service

data class Order(val id: String, val total: Long)
`,
      "src/test/kotlin/com/ejemplo/domain/OrderTest.kt": "class OrderTest\n",
      "build/libs/tienda.jar": "binario\n",
    },
    veta: "com.fasterxml.jackson.core:jackson-databind",
    fuente: "src/main/kotlin/com/ejemplo/domain/Order.kt",
    importa: "org.springframework",
    test: "src/test/kotlin/com/ejemplo/domain/OrderTest.kt",
    derivado: "build/libs/tienda.jar",
    capa: "src/main/kotlin/com/ejemplo/domain",
  },
  python: {
    manifiesto: "pyproject.toml",
    archivos: {
      "pyproject.toml": `[tool.poetry]
name = "tienda"
version = "1.0.0"

[tool.poetry.dependencies]
python = "^3.12"
requests = "^2.31.0"
`,
      "src/tienda/domain/order.py": `from dataclasses import dataclass

from fastapi import FastAPI


@dataclass
class Order:
    id: str
    total: int
`,
      "src/tienda/domain/order.pyi": "class Order: ...\n",
      "tests/test_order.py": "def test_order(): pass\n",
      ".venv/lib/python3.12/site-packages/x.py": "# dependencia\n",
    },
    veta: "requests",
    fuente: "src/tienda/domain/order.py",
    importa: "fastapi",
    test: "tests/test_order.py",
    derivado: ".venv/lib/python3.12/site-packages/x.py",
    capa: "src/tienda/domain",
  },
  go: {
    manifiesto: "go.mod",
    archivos: {
      "go.mod": `module github.com/ejemplo/tienda

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/google/uuid v1.6.0
)
`,
      "internal/domain/order.go": `package domain

import (
	"net/http"
)

type Order struct {
	ID    string
	Total int64
}

var _ = http.StatusOK
`,
      "internal/domain/order_test.go": "package domain\n",
      "vendor/github.com/x/y.go": "package y\n",
    },
    veta: "github.com/gin-gonic/gin",
    fuente: "internal/domain/order.go",
    importa: "net/http",
    test: "internal/domain/order_test.go",
    derivado: "vendor/github.com/x/y.go",
    capa: "internal/domain",
  },
  rust: {
    manifiesto: "Cargo.toml",
    archivos: {
      "Cargo.toml": `[package]
name = "tienda"
version = "1.0.0"
edition = "2021"

[dependencies]
reqwest = "0.11"
serde = { version = "1.0", features = ["derive"] }
`,
      "src/domain/order.rs": `use reqwest::Client;

pub struct Order {
    pub id: String,
    pub total: i64,
}
`,
      "tests/order.rs": "#[test]\nfn ok() {}\n",
      "target/debug/tienda": "binario\n",
    },
    veta: "reqwest",
    fuente: "src/domain/order.rs",
    importa: "reqwest",
    test: "tests/order.rs",
    derivado: "target/debug/tienda",
    capa: "src/domain",
  },
  node: {
    manifiesto: "package.json",
    archivos: {
      "package.json": `{
  "name": "tienda",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "moment": "^2.30.1"
  }
}
`,
      "src/lib/order.mjs": `import express from "express";

export const total = (items) => items.reduce((a, b) => a + b.precio, 0);
`,
      "tests/order.test.mjs": "import { test } from 'node:test';\ntest('ok', () => {});\n",
      "dist/bundle.js": "// derivado\n",
    },
    veta: "moment",
    fuente: "src/lib/order.mjs",
    importa: "express",
    test: "tests/order.test.mjs",
    derivado: "dist/bundle.js",
    capa: "src/lib",
  },
  front: {
    manifiesto: "package.json",
    archivos: {
      "package.json": `{
  "name": "tienda-web",
  "version": "1.0.0",
  "dependencies": {
    "moment": "^2.30.1"
  }
}
`,
      "vite.config.ts": `export default { plugins: [] };\n`,
      "src/lib/total.ts": `import React from "react";

export const total = (items: { precio: number }[]) => items.reduce((a, b) => a + b.precio, 0);
`,
      "src/App.vue": "<template><div /></template>\n",
      "src/__tests__/total.test.ts": "import { it } from 'vitest';\nit('ok', () => {});\n",
      "dist/assets/index.js": "// derivado\n",
    },
    veta: "moment",
    fuente: "src/lib/total.ts",
    importa: "react",
    test: "src/__tests__/total.test.ts",
    derivado: "dist/assets/index.js",
    capa: "src/lib",
  },
};

// ── Utilidades ───────────────────────────────────────────────────────────────

const correr = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { status: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const hook = (repo, archivo, payload) =>
  correr("node", [path.join(repo, ".claude/hooks", archivo)], { input: JSON.stringify(payload), cwd: repo });

const escritura = (repo, rel) => ({
  cwd: repo,
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: path.join(repo, rel), content: "x" },
});

const resultados = [];
const registrar = (stack, nombre, ok, detalle = "") => {
  resultados.push({ stack, nombre, ok, detalle });
  const marca = ok ? "✓" : "✗";
  console.log(`   ${marca} ${nombre}${ok || !detalle ? "" : `\n       ${detalle.split("\n").slice(0, 3).join("\n       ")}`}`);
};

// ── Un stack ─────────────────────────────────────────────────────────────────

function probar(stack, fx) {
  console.log(`\n── ${stack} ${"─".repeat(Math.max(0, 60 - stack.length))}`);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `banco-${stack}-`));
  const repo = path.join(base, "tienda");
  fs.mkdirSync(repo, { recursive: true });

  try {
    // 1. El repo del stack, con archivos reales.
    for (const [rel, contenido] of Object.entries(fx.archivos)) {
      const dest = path.join(repo, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, contenido);
    }
    correr("git", ["init", "-q", repo]);
    correr("git", ["-C", repo, "config", "user.email", "banco@example.com"]);
    correr("git", ["-C", repo, "config", "user.name", "banco"]);

    // 2. Detección automática del stack (sin --perfil).
    const deteccion = correr("node", [path.join(ARNES, "scripts/harness-init.mjs"), repo]);
    const detectado = /Perfil de stack \(detectado\): (\S+)/.exec(deteccion.salida)?.[1];
    const varios = /Varios stacks detectados: (.+)/.exec(deteccion.salida)?.[1];
    registrar(
      stack,
      "el instalador detecta el stack solo",
      detectado === stack || (varios ?? "").split(", ").includes(stack),
      `salió: ${detectado ?? varios ?? deteccion.salida.trim().split("\n")[0]}`,
    );
    registrar(stack, "el dry-run no escribe nada", !fs.existsSync(path.join(repo, ".claude")), "apareció .claude/ en dry-run");

    // 3. Instalación real con el perfil.
    const instalar = correr("node", [path.join(ARNES, "scripts/harness-init.mjs"), repo, "--perfil", stack, "--apply"]);
    if (instalar.status !== 0) {
      registrar(stack, "instalación", false, instalar.salida.trim());
      return;
    }
    registrar(stack, "instalación con --perfil", true);

    // 4. Llenar el config como lo haría el equipo (es el paso que ninguna herramienta hace).
    const cfgPath = path.join(repo, ".claude/harness.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    cfg.forbiddenDeps.manifest = fx.manifiesto;
    cfg.forbiddenDeps.packages = [fx.veta];
    cfg.forbiddenDeps.reason = "decisión del equipo de juguete.";
    cfg.purity = [
      {
        dir: fx.capa,
        forbiddenImports: [fx.importa],
        except: [],
        reason: "el dominio no conoce el framework.",
      },
    ];
    cfg.gate.codeGlobs = [fx.fuente.split("/")[0] + "/"];
    // Lo que no aplica se BORRA, no se deja con placeholder (lo dice el `$arranque`).
    delete cfg.reuse;
    delete cfg.singleSource;
    delete cfg.invariants;
    delete cfg.patterns;
    cfg.tracker.kind = "github";
    cfg.commitMsg.codePattern = `^(${fx.fuente.split("/")[0]}/|scripts/)`;
    cfg.status.reminder = "Recordá: nada se entrega sin `bash scripts/gate.sh` verde.";
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);

    const lint = (args, opts) => correr("node", [path.join(repo, "scripts/repo-lint.mjs"), ...args], { cwd: repo, ...opts });

    // 5. DEPS: ¿el `matcher` del perfil case el manifiesto REAL de este stack?
    const deps = lint([]);
    registrar(
      stack,
      `DEPS caza \`${fx.veta}\` en ${fx.manifiesto} real`,
      deps.status !== 0 && deps.salida.includes("DEPS") && deps.salida.includes(fx.veta),
      deps.salida.trim() || "el lint pasó con la dependencia vetada presente",
    );

    // 6. PUREZA: ¿la sintaxis de import del perfil caza el import REAL?
    const pureza = lint(["--file", fx.fuente]);
    registrar(
      stack,
      `PUREZA caza \`${fx.importa}\` con la sintaxis del stack`,
      pureza.status !== 0 && pureza.salida.includes("PUREZA"),
      pureza.salida.trim() || "el import prohibido pasó",
    );

    // 7. El lint no muerde de más: el test y el manifiesto del propio repo pasan.
    const inocente = lint(["--file", fx.test]);
    registrar(stack, "el lint deja pasar un test normal", inocente.status === 0, inocente.salida.trim());

    // 8. `tests.filePattern` reconoce el layout real del stack.
    let cazaTest = false;
    try {
      cazaTest = new RegExp(cfg.tests.filePattern).test(fx.test);
    } catch (e) {
      cazaTest = false;
    }
    registrar(stack, `tests.filePattern reconoce ${fx.test}`, cazaTest, `patrón: ${cfg.tests.filePattern}`);

    // 9. post-edit-check: editar el fuente real ensucia el gate.
    const marcador = path.join(repo, cfg.gate.marker);
    fs.rmSync(marcador, { force: true });
    hook(repo, "post-edit-check.mjs", {
      ...escritura(repo, fx.fuente),
      hook_event_name: "PostToolUse",
    });
    registrar(stack, `editar ${fx.fuente} marca el gate`, fs.existsSync(marcador), "no se creó el marcador");
    fs.rmSync(marcador, { force: true });

    // 10. protected-paths: el directorio derivado del stack está protegido.
    const derivado = hook(repo, "protected-paths.mjs", escritura(repo, fx.derivado));
    registrar(stack, `protected-paths bloquea ${fx.derivado}`, derivado.status === 2, `exit ${derivado.status}`);

    // 11. …y no bloquea el código normal.
    const normal = hook(repo, "protected-paths.mjs", escritura(repo, fx.fuente));
    registrar(stack, "protected-paths deja pasar el fuente", normal.status === 0, `exit ${normal.status}`);

    // 12. Los punteros del arnés recién instalado: ningún documento copiado puede citar algo
    //     que el instalador no copió (P10). Es lo que salía rojo el primer día.
    const punteros = correr("node", [path.join(repo, "scripts/docs-linkcheck.mjs")], { cwd: repo });
    registrar(stack, "el arnés instalado no apunta a la nada", punteros.status === 0, punteros.salida.trim());

    // 13. El gate del repo portado, de punta a punta. Se mide que CORRA y que su rojo sea
    //     explicable (los placeholders del config de arranque), no que sea verde.
    if (CON_GATE) {
      const gate = correr("bash", [path.join(repo, "scripts/gate.sh")], { cwd: repo });
      const corrio = /──▶ self-test del arnés/.test(gate.salida);
      registrar(stack, "el gate del repo portado corre", corrio, gate.salida.trim().split("\n").slice(-3).join("\n"));
      const razones = [...gate.salida.matchAll(/✗ (.+)/g)].map((m) => m[1]);
      console.log(`   · gate del destino: ${gate.status === 0 ? "VERDE" : "ROJO"}${razones.length ? ` (${razones.join(", ")})` : ""}`);
    }

    // 14. commit-msg: el registro de trabajo funciona en el layout de este stack.
    correr("git", ["-C", repo, "config", "core.hooksPath", ".githooks"]);
    correr("git", ["-C", repo, "add", fx.fuente]);
    const msg = path.join(base, "MSG");
    fs.writeFileSync(msg, "feat: algo");
    const sinRef = correr("bash", [path.join(repo, ".githooks/commit-msg"), msg], { cwd: repo });
    fs.writeFileSync(msg, "feat: algo\n\nRefs #12");
    const conRef = correr("bash", [path.join(repo, ".githooks/commit-msg"), msg], { cwd: repo });
    registrar(
      stack,
      "commit-msg exige el ítem de trabajo en este layout",
      sinRef.status === 1 && conRef.status === 0,
      `sin referencia: exit ${sinRef.status} (esperaba 1) · con referencia: exit ${conRef.status} (esperaba 0)`,
    );

    if (CONSERVAR) console.log(`   · repo conservado en ${repo}`);
  } finally {
    if (!CONSERVAR) fs.rmSync(base, { recursive: true, force: true });
  }
}

// ── Ejecución ────────────────────────────────────────────────────────────────

console.log(`Banco de perfiles — arnés en ${ARNES}`);
console.log("Cada stack se instala en su propio repo git temporal. Nada se escribe en el arnés.");

for (const [stack, fx] of Object.entries(FIXTURES)) {
  if (SOLO && stack !== SOLO) continue;
  probar(stack, fx);
}

// Resumen
const porStack = new Map();
for (const r of resultados) {
  const acc = porStack.get(r.stack) ?? { ok: 0, mal: 0 };
  acc[r.ok ? "ok" : "mal"] += 1;
  porStack.set(r.stack, acc);
}
console.log(`\n${"═".repeat(64)}\nRESUMEN\n`);
for (const [stack, { ok, mal }] of porStack) {
  console.log(`  ${mal ? "✗" : "✓"} ${stack.padEnd(12)} ${ok} pasan${mal ? `, ${mal} FALLAN` : ""}`);
}
const fallos = resultados.filter((r) => !r.ok);
if (fallos.length) {
  console.log(`\n${fallos.length} comprobación(es) fallando:\n`);
  for (const f of fallos) console.log(`  ${f.stack}: ${f.nombre}\n     ${f.detalle.split("\n")[0]}`);
  process.exit(1);
}
console.log(`\nBANCO VERDE — ${resultados.length} comprobaciones sobre ${porStack.size} stack(s) real(es).`);

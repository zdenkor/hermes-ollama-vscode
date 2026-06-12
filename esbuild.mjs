import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    target: "node20",
    outfile: "out/extension.js",
    external: ["vscode"],
    logLevel: "silent",
  });

  if (watch) {
    await ctx.watch();
    console.log("[watch] done, watching...");
  } else {
    await ctx.rebuild();
    console.log("[build] done");
    await ctx.dispose();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

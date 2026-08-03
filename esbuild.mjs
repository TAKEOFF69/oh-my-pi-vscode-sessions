import * as esbuild from "esbuild";

const prod = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode", "@lydell/node-pty"],
  sourcemap: prod ? false : "inline",
  minify: prod,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ["src/rpc/webview.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "dist/rpc-webview.js",
  sourcemap: prod ? false : "inline",
  minify: prod,
  logLevel: "info",
};

const sidebarWebviewOptions = {
  entryPoints: ["src/sidebar/webview.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "dist/sidebar-webview.js",
  sourcemap: prod ? false : "inline",
  minify: prod,
  logLevel: "info",
};

if (watch) {
  const extensionContext = await esbuild.context(extensionOptions);
  const webviewContext = await esbuild.context(webviewOptions);
  const sidebarWebviewContext = await esbuild.context(sidebarWebviewOptions);
  await Promise.all([
    extensionContext.watch(),
    webviewContext.watch(),
    sidebarWebviewContext.watch(),
  ]);
  console.log("[esbuild] watching...");
} else {
  await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(webviewOptions),
    esbuild.build(sidebarWebviewOptions),
  ]);
  console.log("[esbuild] build complete");
}

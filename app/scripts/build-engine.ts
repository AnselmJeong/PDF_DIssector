// Stage the Python engine for the app bundle in app/engine-dist/:
//   engine-dist/pdfx            the pdfx package (with vendor/lgr scripts, references, assets)
//   engine-dist/references      PDF Dissector prompt addenda
//   engine-dist/site-packages   pdfplumber, fonttools, pillow, beautifulsoup4, lxml
//   engine-dist/python          a relocatable CPython (python-build-standalone, as installed by uv)
// electrobun.config.ts copies engine-dist to Resources/app/engine. Run: bun scripts/build-engine.ts
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const app = resolve(import.meta.dir, "..");
const engine = resolve(app, "../engine");
const out = join(app, "engine-dist");
const PY = process.env.PDFX_PY_VERSION ?? "3.12";

const run = (cmd: string[], opts: { cwd?: string } = {}) => {
	const r = Bun.spawnSync(cmd, { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
	if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed:\n${r.stderr.toString()}`);
	return r.stdout.toString().trim();
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. the package (no tests, caches or venv)
cpSync(join(engine, "pdfx"), join(out, "pdfx"), {
	recursive: true,
	filter: (src) => !/(__pycache__|\.pytest_cache|[\\/]tests([\\/]|$)|\.pyc$)/.test(src),
});
cpSync(join(engine, "references"), join(out, "references"), { recursive: true });

// 2. a relocatable interpreter: uv installs python-build-standalone builds
run(["uv", "python", "install", PY]);
const pyBin = realpathSync(run(["uv", "python", "find", "--managed-python", PY]));
const pyHome = resolve(dirname(pyBin), "..");
if (!existsSync(join(pyHome, "lib"))) throw new Error(`unexpected python layout at ${pyHome}`);
cpSync(pyHome, join(out, "python"), {
	recursive: true,
	verbatimSymlinks: true,
	// the uv interpreter may carry the user's own packages: ship only the standard library
	filter: (src) =>
		!/([\\/]test[\\/]|[\\/]idlelib[\\/]|[\\/]tkinter[\\/]|[\\/]ensurepip[\\/]|__pycache__|[\\/]python3\.\d+[\\/]site-packages[\\/].|[\\/](tcl|tk|itcl)[\d.]+)/.test(src) &&
		!/lib(tcl|tk)[\d.]+\.dylib$/.test(src),
});

// 3. dependencies, installed for that interpreter into site-packages (no network at app run time)
const deps = ["pdfplumber>=0.10", "fonttools>=4", "pillow", "beautifulsoup4", "lxml"];
run(["uv", "pip", "install", "--python", join(out, "python", "bin", "python3"), "--target", join(out, "site-packages"), ...deps]);

// 4. smoke test: the staged engine answers ping
const ping = Bun.spawnSync([join(out, "python", "bin", "python3"), "-m", "pdfx", "run", "ping"], {
	cwd: out,
	env: { ...process.env, PYTHONPATH: `${out}:${join(out, "site-packages")}` },
});
console.log(ping.stdout.toString().trim());
if (ping.exitCode !== 0) throw new Error(ping.stderr.toString());
const size = run(["du", "-sh", out]).split(/\s+/)[0];
console.log(`engine staged in ${out} (${size})`);

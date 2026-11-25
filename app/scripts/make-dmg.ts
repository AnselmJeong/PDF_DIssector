// Build the macOS DMG users install from: a plain drag-install image holding only
// "PDF Dissector.app" and an /Applications symlink.
//
// Why this exists: `electrobun build --env=stable` puts a self-extracting wrapper app in
// build/<env>-macos-<arch>/ (a tiny "launcher" plus Resources/<hash>.tar.zst) and its own
// artifacts/*.dmg contains that wrapper, which shows a "Setup" window on first launch and
// can fail with "Installation failed". We never ship that. Instead we unpack the real app
// from the tar.zst payload and pack it ourselves.
//
// Run after `hutch electrobun build --env=stable` (the `build` script does this).
// Output: ../release/PDF-Dissector-<version>-<arch>.dmg
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const app = resolve(import.meta.dir, "..");
const env = process.argv[2] ?? "stable";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const APP_NAME = "PDF Dissector";

const run = (cmd: string[]) => {
	const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
	if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed:\n${r.stderr.toString()}${r.stdout.toString()}`);
	return r.stdout.toString().trim();
};

const buildDir = join(app, "build", `${env}-macos-${arch}`);
const wrapper = join(buildDir, `${APP_NAME}.app`);
if (!existsSync(wrapper)) throw new Error(`no build at ${wrapper}; run hutch electrobun build --env=${env} first`);

// 1. unpack the real app from the wrapper's payload
const res = join(wrapper, "Contents", "Resources");
const payload = readdirSync(res).find((f) => f.endsWith(".tar.zst"));
const staging = join(app, "build", `dmg-${env}-${arch}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
if (payload) {
	run(["tar", "--zstd", "-xf", join(res, payload), "-C", staging]);
} else {
	// already a plain app (no self-extractor): copy it as is
	run(["ditto", wrapper, join(staging, `${APP_NAME}.app`)]);
}
const realApp = join(staging, `${APP_NAME}.app`);
const versionFile = join(realApp, "Contents", "Resources", "version.json");
if (!existsSync(versionFile)) throw new Error(`unpacked app has no version.json: ${realApp}`);
const { version } = JSON.parse(readFileSync(versionFile, "utf8")) as { version: string };

// guard: the shipped app must be the real one, not the self-extracting wrapper
if (readdirSync(join(realApp, "Contents", "Resources")).some((f) => f.endsWith(".tar.zst")))
	throw new Error("unpacked app still looks like a self-extracting wrapper");
if (!existsSync(join(realApp, "Contents", "Resources", "app")))
	throw new Error("unpacked app has no Resources/app (main process bundle)");

// 2. ad-hoc sign the whole bundle (unsigned arm64 code must carry a valid signature)
run(["codesign", "--force", "--deep", "--sign", "-", realApp]);
run(["codesign", "--verify", "--deep", "--strict", realApp]);

// 3. drag-install layout: the app + /Applications symlink, nothing else
symlinkSync("/Applications", join(staging, "Applications"));

const releaseDir = resolve(app, "..", "release");
mkdirSync(releaseDir, { recursive: true });
const dmg = join(releaseDir, `PDF-Dissector-${version}-${arch}.dmg`);
rmSync(dmg, { force: true });
run(["hdiutil", "create", "-volname", APP_NAME, "-srcfolder", staging, "-fs", "HFS+", "-format", "UDZO", "-ov", dmg]);

// electrobun's own DMGs (artifacts/ and build/<env>-macos-<arch>/) hold the wrapper: remove it so it can't be shipped by mistake
for (const dir of [join(app, "artifacts"), buildDir])
	for (const f of existsSync(dir) ? readdirSync(dir) : []) if (f.endsWith(".dmg")) rmSync(join(dir, f));

console.log(`DMG: ${dmg} (${run(["du", "-h", dmg]).split(/\s+/)[0]}) — ${APP_NAME}.app ${version} + Applications`);

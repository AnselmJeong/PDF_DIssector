// API key storage in the macOS Keychain via the `security` CLI. Falls back to a 0600 file elsewhere (dev/Linux).
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = "dev.anselm.pdfdissector";
const ACCOUNT = "anthropic-api-key";

export class SecretStore {
	constructor(private fallbackDir: string) {}

	private get file() {
		return join(this.fallbackDir, ".api-key");
	}

	private useKeychain() {
		return process.platform === "darwin" && !process.env.PDFX_NO_KEYCHAIN;
	}

	get(): string | null {
		if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
		if (this.useKeychain()) {
			const r = Bun.spawnSync(["security", "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
			if (r.exitCode === 0) return r.stdout.toString().trim() || null;
			return null;
		}
		return existsSync(this.file) ? readFileSync(this.file, "utf8").trim() || null : null;
	}

	set(key: string | null) {
		if (this.useKeychain()) {
			Bun.spawnSync(["security", "delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
			if (key) {
				// -w as the last argument with a value; the key is passed as an argv element, never through a shell
				const r = Bun.spawnSync(["security", "add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-U", "-w", key]);
				if (r.exitCode !== 0) throw new Error("Keychain에 API 키를 저장하지 못했습니다: " + r.stderr.toString());
			}
			return;
		}
		if (!key) {
			if (existsSync(this.file)) unlinkSync(this.file);
			return;
		}
		writeFileSync(this.file, key);
		chmodSync(this.file, 0o600);
	}

	has() {
		return !!this.get();
	}
}

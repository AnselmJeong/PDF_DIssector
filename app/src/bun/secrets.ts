// API key storage in the macOS Keychain via the `security` CLI. Falls back to a 0600 file elsewhere (dev/Linux).
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = "dev.anselm.pdfdissector";

export class SecretStore {
	/** One store per key: the Anthropic key (default) or the Ollama Cloud key. */
	constructor(
		private fallbackDir: string,
		private account = "anthropic-api-key",
		private envVar = "ANTHROPIC_API_KEY",
		private fileName = ".api-key",
	) {}

	private get file() {
		return join(this.fallbackDir, this.fileName);
	}

	private useKeychain() {
		return process.platform === "darwin" && !process.env.PDFX_NO_KEYCHAIN;
	}

	get(): string | null {
		if (process.env[this.envVar]) return process.env[this.envVar] as string;
		if (this.useKeychain()) {
			const r = Bun.spawnSync(["security", "find-generic-password", "-s", SERVICE, "-a", this.account, "-w"]);
			if (r.exitCode === 0) return r.stdout.toString().trim() || null;
			return null;
		}
		return existsSync(this.file) ? readFileSync(this.file, "utf8").trim() || null : null;
	}

	set(key: string | null) {
		if (this.useKeychain()) {
			Bun.spawnSync(["security", "delete-generic-password", "-s", SERVICE, "-a", this.account]);
			if (key) {
				// -w as the last argument with a value; the key is passed as an argv element, never through a shell
				const r = Bun.spawnSync(["security", "add-generic-password", "-s", SERVICE, "-a", this.account, "-U", "-w", key]);
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

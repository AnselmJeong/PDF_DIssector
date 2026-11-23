import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "PDF Dissector",
		identifier: "dev.anselm.pdfdissector",
		version: "0.1.0",
	},
	build: {
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			// Python engine (pdfx + vendored scripts). scripts/build-engine.ts stages it in engine-dist/.
			"engine-dist": "engine",
		},
		watchIgnore: ["dist/**", "engine-dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
} satisfies ElectrobunConfig;

// @hutch cli=0.30.0 cottontail=0.7.3
export default {
	packageManager: "bun",
	scripts: {
		install: ["bun", "install"],
		start: "hutch electrobun prepare && bunx vite build && hutch electrobun dev",
		dev: "hutch electrobun prepare && bunx vite build && hutch electrobun dev --watch",
		"dev:hmr": ["bunx", "concurrently", "hutch run hmr", "hutch run start"],
		hmr: "hutch electrobun prepare && bunx vite --port 5173",
		build: "hutch electrobun prepare && bunx vite build && bun scripts/build-engine.ts && hutch electrobun build --env=stable",
		"build:canary": "hutch electrobun prepare && bunx vite build && bun scripts/build-engine.ts && hutch electrobun build --env=canary",
	},
	electrobun: {
		version: "2.0.7",
	},
};

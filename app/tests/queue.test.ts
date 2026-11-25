// The job queue: at most `parallelDocs` papers run at once, the rest wait in order.
import { expect, test } from "bun:test";
import { JobRunner } from "../src/bun/jobs/runner";

function makeRunner(parallelDocs: number) {
	const status: Record<string, string> = {};
	const done: string[] = [];
	const lib = {
		updateDocument: (id: string, p: { status?: string }) => p.status && (status[id] = p.status),
		getStages: () => [],
		clearStagesFrom: () => {},
	};
	const runner = new JobRunner({
		lib: lib as never,
		bridge: { cancel: () => {} } as never,
		llm: () => {
			throw new Error("no llm");
		},
		refs: async () => ({}) as never,
		settings: () => ({ parallelDocs }) as never,
		emit: { progress: () => {}, done: (m) => done.push(`${m.docId}:${m.ok}`) },
	});
	// replace the pipeline with jobs the test finishes by hand
	const finish = new Map<string, () => void>();
	(runner as unknown as { run: (id: string) => Promise<void> }).run = (id: string) => new Promise<void>((res) => finish.set(id, res));
	return { runner, status, done, finish };
}

test("queue runs parallelDocs papers at once and starts the next when one finishes", async () => {
	const { runner, status, done, finish } = makeRunner(2);
	for (const id of ["a", "b", "c", "d"]) runner.start(id);
	expect([runner.isRunning("a"), runner.isRunning("b"), runner.isRunning("c")]).toEqual([true, true, false]);
	expect(status).toEqual({ a: "processing", b: "processing", c: "queued", d: "queued" });
	expect([runner.queuePosition("c"), runner.queuePosition("d")]).toEqual([1, 2]);

	// starting a queued paper again does not queue it twice
	runner.start("c");
	expect(runner.queuePosition("d")).toBe(2);

	// cancelling a waiting paper removes it from the line
	runner.cancel("c");
	expect(status.c).toBe("canceled");
	expect(runner.queuePosition("d")).toBe(1);

	finish.get("a")!();
	await Bun.sleep(5);
	expect(done).toContain("a:true");
	expect(runner.isRunning("d")).toBe(true);
	expect(status.d).toBe("processing");
	expect(runner.queuePosition("d")).toBeNull();
});

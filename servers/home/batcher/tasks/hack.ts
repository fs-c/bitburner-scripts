import { taskWrapper } from './task.js';

export async function main(ns: NS): Promise<void> {
    await taskWrapper(ns, async (host, opts) => await ns.hack(host, opts));
}

import { getAllServers, id, isPrepped } from './utils.js';
import { TASK_SCRIPTS, Task, TaskType, isTaskResult } from './tasks/task.js';
import { DispatchableTask, TaskDispatcher } from './task-dispatcher.js';

function calculateBatchTaskShells(
    ns: NS,
    target: string,
    relativeMoneyToSteal: number,
    spacerMs: number,
): Omit<DispatchableTask, 'id'>[] {
    // assuming that the server is at max money and min security (= prepped), we want to calculate
    // the relative timing and required thread count for the following tasks such that at the end
    // of the batch the server is prepped again
    // the illustration is adapted from the game documentation and not to scale
    //
    //                    |= hack ====================|               (1)
    //   |= weaken ======================================|            (2)
    //                 |= grow =============================|         (3)
    //         |= weaken ======================================|      (4)
    //
    //   0-------------- time ------------------------|--|----->
    //                                                |-> spacerMs

    if (relativeMoneyToSteal <= 0 || relativeMoneyToSteal > 1) {
        throw new Error('relativeMoneyToSteal must be in (0, 1]');
    }

    if (spacerMs <= 0) {
        throw new Error('spacer must be positive');
    }

    const server = ns.getServer(target);

    const hackTime = ns.getHackTime(target);
    // perhaps a pointless optimization, but otherwise the hack time would be computed three times
    // for no reason (internally in getGrowTime and getWeakenTime)
    const growTime = hackTime * 3.2; // ns.getGrowTime(target)
    const weakenTime = hackTime * 4; // ns.getWeakenTime(target)

    const moneyToSteal = server.moneyMax * relativeMoneyToSteal;
    const serverMoneyAfterHack = server.moneyMax - moneyToSteal;

    // note that we floor hack threads but ceil other threads, we want to keep the server prepped

    // (1)
    const hackThreads = Math.floor(ns.hackAnalyzeThreads(target, moneyToSteal));
    const relativeHackEndTime = 0;
    const relativeHackStartTime = relativeHackEndTime - hackTime;

    // (2)
    // security increase from the hack threads / security decrease from a single weaken thread
    //   = weaken threads
    // this works because weaken is linear in the number of threads
    const weakenHackThreads = Math.ceil(ns.hackAnalyzeSecurity(hackThreads) / ns.weakenAnalyze(1));
    const relativeWeakenHackEndTime = relativeHackEndTime + spacerMs;
    const relativeWeakenHackStartTime = relativeWeakenHackEndTime - weakenTime;

    // (3)
    const growThreads = Math.ceil(ns.growthAnalyze(target, server.moneyMax / serverMoneyAfterHack));
    const relativeGrowEndTime = relativeWeakenHackEndTime + spacerMs;
    const relativeGrowStartTime = relativeGrowEndTime - growTime;

    // (4)
    // again, this works because weaken is linear in the number of threads
    const weakenGrowThreads = Math.ceil(
        ns.growthAnalyzeSecurity(growThreads) / ns.weakenAnalyze(1),
    );
    const relativeWeakenGrowEndTime = relativeGrowEndTime + spacerMs;
    const relativeWeakenGrowStartTime = relativeWeakenGrowEndTime - weakenTime;

    const earliestRelativeStartTime = Math.min(
        relativeHackStartTime,
        relativeWeakenHackStartTime,
        relativeGrowStartTime,
        relativeWeakenGrowStartTime,
    );

    // normalize to make the earliest start time 0
    const hackStartTime = relativeHackStartTime - earliestRelativeStartTime;
    const weakenHackStartTime = relativeWeakenHackStartTime - earliestRelativeStartTime;
    const growStartTime = relativeGrowStartTime - earliestRelativeStartTime;
    const weakenGrowStartTime = relativeWeakenGrowStartTime - earliestRelativeStartTime;

    return [
        {
            taskType: TaskType.Hack,
            target,
            delayMs: hackStartTime,
            threads: hackThreads,
        },
        {
            taskType: TaskType.WeakenHack,
            target,
            delayMs: weakenHackStartTime,
            threads: weakenHackThreads,
        },
        {
            taskType: TaskType.Grow,
            target,
            delayMs: growStartTime,
            threads: growThreads,
        },
        {
            taskType: TaskType.WeakenGrow,
            target,
            delayMs: weakenGrowStartTime,
            threads: weakenGrowThreads,
        },
    ];
}

export async function main(ns: NS): Promise<void> {
    const host = 'home';
    const [target] = ns.args as [string];

    const spacerMs = 50;

    const batchTaskShells = calculateBatchTaskShells(ns, target, 0.8, spacerMs);
    const taskDispatcher = new TaskDispatcher(ns);

    const callbackPortNumber = ns.pid;
    const callbackPort = ns.getPortHandle(callbackPortNumber);

    const startedTasks = new Map<string, Task>();

    // seed the system with some initial batches
    // todo: this just uses a random constant for now
    for (let i = 0; i < 100; i++) {
        const additionalDelayMs = i * spacerMs;

        // todo: factor batch creation out
        for (const shell of batchTaskShells) {
            const task = { ...shell, id: id(), delayMs: shell.delayMs + additionalDelayMs };

            taskDispatcher.start(task, callbackPortNumber);
            startedTasks.set(task.id, task);
        }
    }

    while (true) {
        // wait for the next task to finish
        await callbackPort.nextWrite();

        // it can happen that multiple messages are queued up at this point so we make sure to handle all
        while (!callbackPort.empty()) {
            const message = JSON.parse(callbackPort.read());
            if (!isTaskResult(message)) {
                throw new Error(`unexpected message: ${JSON.stringify(message)}`);
            }

            ns.print(`got task result message ${JSON.stringify(message)}`);

            const task = startedTasks.get(message.taskId);
            if (!task) {
                throw new Error(`unexpected task id ${message.taskId}`);
            }

            if (task.taskType === TaskType.WeakenGrow) {
                // if the task that just finished was a weaken grow then a batch just finished, we
                // now have capacity for another batch
                // todo: this is hacky, we should have a better way to track when a batch finishes

                if (!isPrepped(ns, target)) {
                    ns.print('WARN server is not prepped after batch');
                }

                for (const shell of batchTaskShells) {
                    const task = { ...shell, id: id(), delayMs: shell.delayMs + spacerMs };

                    taskDispatcher.start(task, callbackPortNumber);
                    startedTasks.set(task.id, task);
                }
            }

            startedTasks.delete(task.id);
            startedTasks.delete(task.id);
            taskDispatcher.finish(task.id);
        }
    }
}

import { DispatchableTask } from '../task-dispatcher.js';
import { TaskType } from '../tasks/task.js';
import { id } from '../utils.js';

interface Batch {
    id: string;
    tasks: DispatchableTask[];
}

interface ProtoBatch {
    tasks: Omit<DispatchableTask, 'id'>[];
}

export class BatchFactory {
    private readonly protoBatch: ProtoBatch;

    constructor(
        private readonly ns: NS,
        target: string,
        relativeMoneyToSteal: number,
        spacerMs: number,
    ) {
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
        const weakenHackThreads = Math.ceil(
            ns.hackAnalyzeSecurity(hackThreads) / ns.weakenAnalyze(1),
        );
        const relativeWeakenHackEndTime = relativeHackEndTime + spacerMs;
        const relativeWeakenHackStartTime = relativeWeakenHackEndTime - weakenTime;

        // (3)
        const growThreads = Math.ceil(
            ns.growthAnalyze(target, server.moneyMax / serverMoneyAfterHack),
        );
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

        const tasks = [
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

        ns.print(
            `calculated proto batch for ${target} (%$: ${relativeMoneyToSteal}, ms: ${spacerMs}) with ${tasks.length} tasks:`,
        );
        ns.print(JSON.stringify(tasks, null, 4));

        this.protoBatch = { tasks };
    }

    public createBatch(additionalDelayMs: number): Batch {
        return {
            id: id(),
            tasks: this.protoBatch.tasks.map((taskShell) => ({
                ...taskShell,
                id: id(),
                delayMs: taskShell.delayMs + additionalDelayMs,
            })),
        };
    }
}

import { DispatchableTask } from '../tasks/task-dispatcher.js';
import { TaskType } from '../tasks/task.js';
import { id } from '../../utils.js';

export interface Batch {
    id: string;
    target: string;
    tasks: DispatchableTask[];
}

interface ProtoBatch {
    target: string;
    tasks: Omit<DispatchableTask, 'id'>[];
    depth: number;
}

export class BatchFactory {
    private readonly protoHWGWBatch: ProtoBatch;
    private readonly protoGWBatch: ProtoBatch;

    get hwgwBatchDepth(): number {
        return this.protoHWGWBatch.depth;
    }

    get gwBatchDepth(): number {
        return this.protoGWBatch.depth;
    }

    constructor(
        private readonly ns: NS,
        target: string,
        relativeMoneyToSteal: number,
        spacerMs: number,
    ) {
        this.protoHWGWBatch = calculateProtoHWGWBatch(
            this.ns,
            target,
            relativeMoneyToSteal,
            spacerMs,
        );

        this.protoGWBatch = calculateProtoGWBatch(this.ns, target, 1.2, spacerMs);
    }

    public createHWGWBatch(additionalDelayMs: number): Batch {
        return this.createBatch(this.protoHWGWBatch, additionalDelayMs);
    }

    public createGWBatch(additionalDelayMs: number): Batch {
        return this.createBatch(this.protoGWBatch, additionalDelayMs);
    }

    private createBatch(protoBatch: ProtoBatch, additionalDelayMs: number): Batch {
        return {
            id: id(),
            tasks: protoBatch.tasks.map((taskShell) => ({
                ...taskShell,
                id: id(),
                delayMs: taskShell.delayMs + additionalDelayMs,
            })),
            target: protoBatch.target,
        };
    }
}

function calculateProtoHWGWBatch(
    ns: NS,
    target: string,
    relativeMoneyToSteal: number,
    spacerMs: number,
): ProtoBatch {
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

    const moneyMax = server.moneyMax;
    if (moneyMax == null) {
        throw new Error(`server ${target} has no moneyMax`);
    }

    const moneyToSteal = moneyMax * relativeMoneyToSteal;
    const serverMoneyAfterHack = moneyMax - moneyToSteal;

    // note that we floor hack threads but ceil other threads, we want to keep the server prepped,
    // even at the cost of some potential inefficiency

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
    const growThreads = Math.ceil(ns.growthAnalyze(target, moneyMax / serverMoneyAfterHack));
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

    const earliestEndTime = Math.min(
        relativeHackEndTime - earliestRelativeStartTime,
        relativeWeakenHackEndTime - earliestRelativeStartTime,
        relativeGrowEndTime - earliestRelativeStartTime,
        relativeWeakenGrowEndTime - earliestRelativeStartTime,
    );

    const depth = Math.floor(earliestEndTime / (spacerMs * tasks.length));

    return { tasks, target, depth };
}

function calculateProtoGWBatch(
    ns: NS,
    target: string,
    relativeMoneyToGrow: number,
    spacerMs: number,
): ProtoBatch {
    // see calculateHWGWBatch() for general explanation, except that here we only want
    // grow and weaken, no hack

    if (relativeMoneyToGrow <= 1) {
        throw new Error('relativeMoneyToGrow must be greater than 1');
    }

    if (spacerMs <= 0) {
        throw new Error('spacer must be positive');
    }

    const server = ns.getServer(target);

    const growTime = ns.getGrowTime(target);
    const weakenTime = ns.getWeakenTime(target);

    const moneyMax = server.moneyMax;
    if (moneyMax == null) {
        throw new Error(`server ${target} has no moneyMax`);
    }

    const growThreads = Math.ceil(ns.growthAnalyze(target, relativeMoneyToGrow));
    const relativeGrowEndTime = 0;
    const relativeGrowStartTime = relativeGrowEndTime - growTime;

    const weakenGrowThreads = Math.ceil(
        ns.growthAnalyzeSecurity(growThreads) / ns.weakenAnalyze(1),
    );
    const relativeWeakenGrowEndTime = relativeGrowEndTime + spacerMs;
    const relativeWeakenGrowStartTime = relativeWeakenGrowEndTime - weakenTime;

    const earliestRelativeStartTime = Math.min(relativeGrowStartTime, relativeWeakenGrowStartTime);

    const growStartTime = relativeGrowStartTime - earliestRelativeStartTime;
    const weakenGrowStartTime = relativeWeakenGrowStartTime - earliestRelativeStartTime;

    const tasks = [
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

    const earliestEndTime = Math.min(
        relativeGrowEndTime - earliestRelativeStartTime,
        relativeWeakenGrowEndTime - earliestRelativeStartTime,
    );

    const depth = Math.floor(earliestEndTime / (spacerMs * tasks.length));

    return { tasks, target, depth };
}

import { Task, TASK_SCRIPTS, TaskType } from '../tasks/task.js';
import { id } from '../../utils.js';
import { Batch } from './batch.js';

export class ProtoBatch {
    public static createHWGW(
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

        const hackTime = ns.getHackTime(target);
        const growTime = ns.getGrowTime(target);
        const weakenTime = ns.getWeakenTime(target);

        const maxMoney = ns.getServerMaxMoney(target);
        if (maxMoney === 0) {
            throw new Error(`server ${target} has max money 0`);
        }

        const moneyToSteal = maxMoney * relativeMoneyToSteal;
        const serverMoneyAfterHack = maxMoney - moneyToSteal;

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
        const weakenHackThreads = Math.ceil(
            ns.hackAnalyzeSecurity(hackThreads) / ns.weakenAnalyze(1),
        );
        const relativeWeakenHackEndTime = relativeHackEndTime + spacerMs;
        const relativeWeakenHackStartTime = relativeWeakenHackEndTime - weakenTime;

        // (3)
        const growThreads = Math.ceil(ns.growthAnalyze(target, maxMoney / serverMoneyAfterHack));
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

        const tasks: Task[] = [
            {
                taskType: TaskType.Hack,
                target,
                startTime: hackStartTime,
                endTime: hackStartTime + hackTime,
                threads: hackThreads,
            },
            {
                taskType: TaskType.WeakenHack,
                target,
                startTime: weakenHackStartTime,
                endTime: weakenHackStartTime + weakenTime,
                threads: weakenHackThreads,
            },
            {
                taskType: TaskType.Grow,
                target,
                startTime: growStartTime,
                endTime: growStartTime + growTime,
                threads: growThreads,
            },
            {
                taskType: TaskType.WeakenGrow,
                target,
                startTime: weakenGrowStartTime,
                endTime: weakenGrowStartTime + weakenTime,
                threads: weakenGrowThreads,
            },
        ];

        return new ProtoBatch(target, tasks, spacerMs, { money: moneyToSteal });
    }

    public static createGW(
        ns: NS,
        target: string,
        relativeMoneyToGrow: number,
        spacerMs: number,
    ): ProtoBatch {
        // see calculateHWGWBatch() for general explanation, except that here we only want
        // grow and weaken, no hack

        const growTime = ns.getGrowTime(target);
        const weakenTime = ns.getWeakenTime(target);

        const maxMoney = ns.getServerMaxMoney(target);
        if (maxMoney === 0) {
            throw new Error(`server ${target} has max money 0`);
        }

        const growThreads = Math.ceil(ns.growthAnalyze(target, relativeMoneyToGrow));
        const relativeGrowEndTime = 0;
        const relativeGrowStartTime = relativeGrowEndTime - growTime;

        const growSecurityIncrease = ns.growthAnalyzeSecurity(growThreads);
        const weakenGrowThreads = Math.ceil(growSecurityIncrease / ns.weakenAnalyze(1));
        const relativeWeakenGrowEndTime = relativeGrowEndTime + spacerMs;
        const relativeWeakenGrowStartTime = relativeWeakenGrowEndTime - weakenTime;

        const earliestRelativeStartTime = Math.min(
            relativeGrowStartTime,
            relativeWeakenGrowStartTime,
        );

        const growStartTime = relativeGrowStartTime - earliestRelativeStartTime;
        const weakenGrowStartTime = relativeWeakenGrowStartTime - earliestRelativeStartTime;

        const tasks: Task[] = [
            {
                taskType: TaskType.Grow,
                target,
                startTime: growStartTime,
                endTime: growStartTime + growTime,
                threads: growThreads,
            },
            {
                taskType: TaskType.WeakenGrow,
                target,
                startTime: weakenGrowStartTime,
                endTime: weakenGrowStartTime + weakenTime,
                threads: weakenGrowThreads,
            },
        ];

        return new ProtoBatch(target, tasks, spacerMs, { money: 0 });
    }

    private constructor(
        private readonly target: string,
        private readonly tasks: Task[],
        private readonly delayMs: number,
        private readonly expectedChange: { money: number },
    ) {}

    public generateBatch(delayMs: number): Batch {
        return {
            id: id(),
            tasks: this.tasks.map((task) => ({
                ...task,
                id: id(),
                startTime: task.startTime + delayMs,
                endTime: task.endTime + delayMs,
            })),
            target: this.target,
        };
    }

    public totalDuration(): number {
        const earliestStartTime = Math.min(...this.tasks.map((task) => task.startTime));
        // todo-optimization: we could depend on tasks being sorted by endTime (which it always is
        // at the moment)
        const latestEndTime = Math.max(...this.tasks.map((task) => task.endTime));

        return latestEndTime - earliestStartTime;
    }

    public unsafeDuration(): number {
        return this.tasks.length * this.delayMs;
    }

    public maxConcurrentBatches(): number {
        // todo: some sources say that the calculation should be
        //  Math.floor(this.totalDuration() / this.unsafeDuration())
        // but i don't see how that would work
        //
        // to me it seems like the number of batches that can be run concurrently is how many times
        // we can start a batch before we overlap with the last start time of a task

        const latestTask = this.tasks.toSorted((a, b) => b.startTime - a.endTime)[0];
        if (latestTask == null) {
            throw new Error('no tasks');
        }

        const latestTaskDuration = latestTask.endTime - latestTask.startTime;

        return Math.floor(latestTaskDuration / this.unsafeDuration());
    }

    public peakRamUsage(): number {
        return this.tasks.reduce(
            (peak, task) => (peak += task.threads * TASK_SCRIPTS[task.taskType].cost),
            0,
        );
    }

    public expectedMoneyChange(): number {
        return this.expectedChange.money;
    }
}

import { BasicHGWOptions } from '@/NetscriptDefinitions';

export enum TaskType {
    Hack = 'Hack',
    Grow = 'Grow',
    // todo: right now we need to distinguish between the two weaken types in the batcher logic but
    //  this is hacky and should not be necessary; we should just have one weaken type
    WeakenHack = 'WeakenHack',
    WeakenGrow = 'WeakenGrow',
}

export interface Task {
    id: string;
    taskType: TaskType;
    target: string;
    delayMs: number;
}

export interface TaskResult {
    type: 'task-result';
    taskId: string;
    taskType: TaskType;
    timeTakenMs: number;
}

export function isTaskResult(object: unknown): object is TaskResult {
    return (
        typeof object === 'object' &&
        object !== null &&
        'type' in object &&
        object.type === 'task-result'
    );
}

export const TASK_SCRIPTS = new Map<TaskType, { path: string; cost: number }>([
    [TaskType.Hack, { path: '/batcher/tasks/hack.js', cost: 1.7 }],
    [TaskType.Grow, { path: '/batcher/tasks/grow.js', cost: 1.75 }],
    [TaskType.WeakenHack, { path: '/batcher/tasks/weaken.js', cost: 1.75 }],
    [TaskType.WeakenGrow, { path: '/batcher/tasks/weaken.js', cost: 1.75 }],
]);

// this is a wrapper to deduplicate the task (hack/grow/weaken) script logic
// since we expect those to have exact ram costs, this wrapper MUST NOT have a ram cost
export async function taskWrapper(
    ns: NS,
    hgwFunction: (host: string, opts: BasicHGWOptions) => Promise<unknown>,
): Promise<void> {
    // todo: there is a ns.atExit() function to add an exit callback, should use that to report
    //       unexpected script death, but there is no way to report errors atm

    const [id, taskType, target, delayMs, port] = ns.args as [
        string,
        TaskType,
        string,
        number,
        number,
    ];

    const opts = { additionalMsec: delayMs };

    const start = Date.now();
    await hgwFunction(target, opts);
    const end = Date.now();

    ns.writePort(
        port,
        JSON.stringify({
            type: 'task-result',
            taskId: id,
            taskType,
            timeTakenMs: end - start,
        } satisfies TaskResult),
    );
}

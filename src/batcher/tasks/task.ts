import type { NS, BasicHGWOptions } from '@ns';

export enum TaskType {
    Hack = 'Hack',
    Grow = 'Grow',
    Weaken = 'Weaken',
}

export interface Task {
    taskType: TaskType;
    target: string;
    startTime: number;
    endTime: number;
    threads: number;
    validReturnValue: number;
}

export interface TaskReport {
    type: 'task-report';
    taskId: string;
    taskType: TaskType;
    timeTakenMs: number;
    returnValue: number;
}

export function isTaskReport(object: unknown): object is TaskReport {
    return (
        typeof object === 'object' &&
        object !== null &&
        'type' in object &&
        object.type === 'task-report'
    );
}

export const TASK_SCRIPTS: Record<TaskType, { path: string; cost: number }> = {
    [TaskType.Hack]: { path: '/batcher/tasks/hack.js', cost: 1.7 },
    [TaskType.Grow]: { path: '/batcher/tasks/grow.js', cost: 1.75 },
    [TaskType.Weaken]: { path: '/batcher/tasks/weaken.js', cost: 1.75 },
};

// this is a wrapper to deduplicate the task (hack/grow/weaken) script logic
// since we expect those to have exact ram costs, this wrapper MUST NOT have a ram cost
export async function taskWrapper(
    ns: NS,
    hgwFunction: (host: string, opts: BasicHGWOptions) => Promise<number>,
): Promise<void> {
    const [id, taskType, target, delayMs, port] = ns.args as [
        string,
        TaskType,
        string,
        number,
        number,
    ];

    const opts = { additionalMsec: delayMs };

    const start = Date.now();
    const returnValue = await hgwFunction(target, opts);
    const end = Date.now();

    ns.writePort(
        port,
        JSON.stringify({
            type: 'task-report',
            taskId: id,
            taskType,
            timeTakenMs: end - start,
            returnValue,
        } satisfies TaskReport),
    );
}

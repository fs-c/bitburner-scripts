import { id, isPrepped } from './utils.js';
import { TASK_SCRIPTS, Task, TaskType, isTaskResult } from './tasks/task.js';
import { TaskDispatcher } from './task-dispatcher.js';
import { calculateProtoBatch, createBatchFromProtoBatch } from './batches/batch.js';
import { BatchFactory } from './batches/batch-factory.js';

function getDepth(ns: NS, target: string, spacerMs: number): number {
    const weakenTime = ns.getWeakenTime(target);
    return Math.floor(weakenTime / (4 * spacerMs));
}

export async function main(ns: NS): Promise<void> {
    // todo: this function is a mess, i am also not sure if BatchFactory is a good concept

    const host = 'home';
    const [target] = ns.args as [string];

    if (!isPrepped(ns, target)) {
        throw new Error('server is not prepped');
    }

    const spacerMs = 50;

    const batchFactory = new BatchFactory(ns, target, 0.5, spacerMs);
    const taskDispatcher = new TaskDispatcher(ns);

    const callbackPortNumber = ns.pid;
    const callbackPort = ns.getPortHandle(callbackPortNumber);

    const startedTasks = new Map<string, Task>();

    ns.atExit(() => {
        for (const [taskId] of startedTasks) {
            taskDispatcher.finish(taskId);
        }
    });

    const depth = getDepth(ns, target, spacerMs) / 2;
    ns.tprint(`depth ${depth}`);

    for (let i = 0; i < depth; i++) {
        // the last task finishes after (tasks.length - 1) * spacer but we also want there to be
        // a spacer between batches
        const additionalDelayMs = i * spacerMs * 4;
        const batch = batchFactory.createBatch(additionalDelayMs);

        for (const task of batch.tasks) {
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

                const newBatch = batchFactory.createBatch(spacerMs * 4);
                for (const task of newBatch.tasks) {
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

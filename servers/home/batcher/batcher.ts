import { TaskType, isTaskResult } from './tasks/task.js';
import { TaskDispatcher } from './tasks/task-dispatcher.js';
import { createLogger } from './logger.js';
import { ProtoBatch } from './batches/proto-batch.js';

const logger = createLogger('batcher');

function isPrepped(ns: NS, server: string): boolean {
    return (
        ns.getServerSecurityLevel(server) <= ns.getServerMinSecurityLevel(server) &&
        ns.getServerMoneyAvailable(server) >= ns.getServerMaxMoney(server)
    );
}

export async function main(ns: NS): Promise<void> {
    // todo: this function is a mess, i am also not sure if BatchFactory is a good concept

    const [target] = ns.args as [string];

    const spacerMs = 5;

    const hackProtoBatch = ProtoBatch.createHWGW(ns, target, 0.7, spacerMs);
    const prepProtoBatch = ProtoBatch.createGW(ns, target, 1.5, spacerMs);

    const taskDispatcher = new TaskDispatcher(ns);

    const callbackPortNumber = ns.pid;
    const callbackPort = ns.getPortHandle(callbackPortNumber);

    const depth = Math.min(
        hackProtoBatch.maxConcurrentBatches(),
        prepProtoBatch.maxConcurrentBatches(),
    );
    const serverIsPrepped = isPrepped(ns, target);

    logger.info(
        ns,
        `starting batcher for ${target} (prepped: ${serverIsPrepped}) with depth ${depth} and spacer ${spacerMs} ms`,
    );

    for (let i = 0; i < depth; i++) {
        // the last task finishes after (tasks.length - 1) * spacer but we also want there to be
        // a spacer between batches
        const additionalDelayMs = i * spacerMs * 4;
        const batch = serverIsPrepped
            ? hackProtoBatch.generateBatch(additionalDelayMs)
            : prepProtoBatch.generateBatch(additionalDelayMs);

        for (const task of batch.tasks) {
            taskDispatcher.dispatch(task, callbackPortNumber);
        }
    }

    while (true) {
        // wait for the next message
        await callbackPort.nextWrite();

        // for every message that we got...
        while (!callbackPort.empty()) {
            const message = JSON.parse(callbackPort.read());
            if (!isTaskResult(message)) {
                throw new Error(`unexpected message: ${JSON.stringify(message)} `);
            }

            logger.debug(ns, `task ${message.taskId} finished: ${JSON.stringify(message)} `);

            const task = taskDispatcher.getDispatchedTask(message.taskId);
            if (task == null) {
                throw new Error(`unexpected task id ${message.taskId} `);
            }

            if (task.taskType === TaskType.WeakenGrow) {
                // if the task that just finished was a weaken grow then a batch just finished, we
                // now have capacity for another batch
                // todo: this is hacky, we should have a better way to track when a batch finishes

                const preppedAfterBatch = isPrepped(ns, target);
                if (!preppedAfterBatch) {
                    logger.warn(ns, 'server is not prepped after batch');
                }

                const newBatch = preppedAfterBatch
                    ? hackProtoBatch.generateBatch(hackProtoBatch.unsafeDuration())
                    : // todo: not sure if different spacings here are safe
                      prepProtoBatch.generateBatch(prepProtoBatch.unsafeDuration());
                for (const task of newBatch.tasks) {
                    taskDispatcher.dispatch(task, callbackPortNumber);
                }
            }

            taskDispatcher.free(task.id);
        }
    }
}

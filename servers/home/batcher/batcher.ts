import { TaskType, isTaskResult } from './tasks/task.js';
import { TaskDispatcher } from './tasks/task-dispatcher.js';
import { BatchFactory } from './batches/batch-factory.js';

function isPrepped(ns: NS, server: string): boolean {
    // ideally we would not need this but there has been the case where a full cycle of batches
    // leaves a server a hair above/below the relevant thresholds so until that is ironed out
    // we will use a tolerance
    const tolerance = 0.05;

    const securityLevelThreshold = ns.getServerMinSecurityLevel(server) * (1 + tolerance);
    const moneyThreshold = ns.getServerMaxMoney(server) * (1 - tolerance);

    return (
        ns.getServerSecurityLevel(server) <= securityLevelThreshold &&
        ns.getServerMoneyAvailable(server) >= moneyThreshold
    );
}

export async function main(ns: NS): Promise<void> {
    // todo: this function is a mess, i am also not sure if BatchFactory is a good concept

    const [target] = ns.args as [string];

    const spacerMs = 50;

    const batchFactory = new BatchFactory(ns, target, 0.95, spacerMs);
    const taskDispatcher = new TaskDispatcher(ns);

    const callbackPortNumber = ns.pid;
    const callbackPort = ns.getPortHandle(callbackPortNumber);

    ns.atExit(() => {
        taskDispatcher.freeAndKillAll();
    });

    const depth = batchFactory.hwgwBatchDepth;
    const serverIsPrepped = isPrepped(ns, target);

    for (let i = 0; i < depth; i++) {
        // the last task finishes after (tasks.length - 1) * spacer but we also want there to be
        // a spacer between batches
        const additionalDelayMs = i * spacerMs * 4;
        const batch = serverIsPrepped
            ? batchFactory.createHWGWBatch(additionalDelayMs)
            : batchFactory.createGWBatch(additionalDelayMs);

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
                throw new Error(`unexpected message: ${JSON.stringify(message)}`);
            }

            ns.print(`task ${message.taskId} finished with result ${JSON.stringify(message)}`);

            const task = taskDispatcher.getDispatchedTask(message.taskId);
            if (task == null) {
                throw new Error(`unexpected task id ${message.taskId}`);
            }

            if (task.taskType === TaskType.WeakenGrow) {
                // if the task that just finished was a weaken grow then a batch just finished, we
                // now have capacity for another batch
                // todo: this is hacky, we should have a better way to track when a batch finishes

                const preppedAfterBatch = isPrepped(ns, target);
                if (!preppedAfterBatch) {
                    ns.print('WARN server is not prepped after batch');
                }

                const newBatch = preppedAfterBatch
                    ? batchFactory.createHWGWBatch(spacerMs * 4)
                    : // todo: we are spacing out the gw batch the same as the hwgw batch, but i am not
                      // sure that is required
                      batchFactory.createGWBatch(spacerMs * 4);
                for (const task of newBatch.tasks) {
                    taskDispatcher.dispatch(task, callbackPortNumber);
                }
            }

            taskDispatcher.free(task.id);
        }
    }
}

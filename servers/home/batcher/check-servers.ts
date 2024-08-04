import { getAllServers } from '../utils.js';
import { createLogger } from './logger.js';
import { TaskDispatcher } from './tasks/task-dispatcher.js';
import { ProtoBatch } from './batches/proto-batch.js';

const logger = createLogger('check-servers');

interface ServerInformation {
    relativeMoneyToSteal: number;
    moneyPerSecond: number;
}

export async function main(ns: NS): Promise<void> {
    const spacerMs = 5; // todo: vary this

    const taskDispatcher = new TaskDispatcher(ns);

    const serverInformation = new Map<string, ServerInformation>();

    const servers = getAllServers(ns);
    for (const target of servers) {
        if (ns.getServerMaxMoney(target) === 0 || target === 'home') {
            continue;
        }

        logger.info(ns, `checking ${target}`);

        const currentBest = { relativeMoneyToSteal: 0, moneyPerSecond: 0 };

        // we are going from low to high values so we can exit early if we can't fit it into ram
        for (
            let relativeMoneyToSteal = 0.1;
            relativeMoneyToSteal < 0.9;
            relativeMoneyToSteal += 0.1
        ) {
            const hackProtoBatch = ProtoBatch.createHWGW(
                ns,
                target,
                relativeMoneyToSteal,
                spacerMs,
            );

            // check if we can theoretically fit it into ram, assuming it were one continuous block
            // we do this first because it is a lot cheaper than actually simulating it
            if (taskDispatcher.totalRam < hackProtoBatch.peakRamUsage()) {
                // if we already don't have enough ram for this there is no way we will have enough
                // for higher steal values
                break;
            }

            const beforeExpensiveCheck = Date.now();

            // now check if we can actually fit it into ram, given the actual block/ram distribution
            const allTasks = [];
            for (let i = 0; i < hackProtoBatch.maxConcurrentBatches(); i++) {
                const batch = hackProtoBatch.generateBatch(spacerMs);
                allTasks.push(...batch.tasks);
            }
            if (!taskDispatcher.couldFit(allTasks)) {
                logger.info(
                    ns,
                    `could not fit in practice, skipping (took ${Date.now() - beforeExpensiveCheck} ms)`,
                );

                // it is very unlikely (but probably not impossible!) that we will be able to fit
                // a higher steal value, for performance we just skip
                break;
            }

            logger.info(
                ns,
                `could fit in practice, continuing (took ${Date.now() - beforeExpensiveCheck} ms)`,
            );

            // we could fit this into ram, let's see how it performs

            const totalMoneyPerCycle =
                hackProtoBatch.maxConcurrentBatches() * hackProtoBatch.expectedMoneyChange();

            const moneyPerSecond = totalMoneyPerCycle / hackProtoBatch.totalDuration() / 1000;
            if (moneyPerSecond > currentBest.moneyPerSecond) {
                currentBest.relativeMoneyToSteal = relativeMoneyToSteal;
                currentBest.moneyPerSecond = moneyPerSecond;
            }
        }

        serverInformation.set(target, currentBest);

        await ns.sleep(1);
    }

    const sortedServerInformation = [...serverInformation.entries()].sort(
        ([serverA, infoA], [serverB, infoB]) => infoB.moneyPerSecond - infoA.moneyPerSecond,
    );

    logger.info(
        ns,
        `${'target'.padEnd(20)} ${'relativeMoneyToSteal'.padEnd(20)} ${'moneyPerSecond'.padEnd(20)}`,
    );
    for (const [server, info] of sortedServerInformation) {
        logger.info(
            ns,
            `${server.padEnd(20)} ${info.relativeMoneyToSteal.toFixed(2).padEnd(20)} ${info.moneyPerSecond.toFixed(2).padEnd(20)}`,
        );
    }
}

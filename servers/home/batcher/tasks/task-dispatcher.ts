import { getAllServers, id } from './utils.js';
import { TASK_SCRIPTS, Task } from './tasks/task.js';

export interface DispatchableTask extends Task {
    threads: number;
}

interface StartedTask {
    server: string;
    ramCost: number;
    pid: number;
}

/**
 * this class dispatches tasks to appropriately sized servers
 * ALL script executions must be done through this class
 */
export class TaskDispatcher {
    private readonly blocks: { server: string; ram: number }[] = [];

    private readonly startedTasks = new Map<string, StartedTask>();

    constructor(private readonly ns: NS) {
        const servers = getAllServers(this.ns);

        const taskScriptPaths = [...TASK_SCRIPTS.values()].map(({ path: script }) => script);

        for (const server of servers) {
            const availableRam = this.ns.getServerMaxRam(server) - this.ns.getServerUsedRam(server);
            if (availableRam === 0) {
                // a bunch of servers have no ram, this is not an error case
                continue;
            }

            this.blocks.push({
                server,
                ram:
                    server === 'home'
                        ? Math.max(0, availableRam - 256) // always reserve some ram on home
                        : availableRam,
            });

            if (!ns.scp(taskScriptPaths, server)) {
                throw new Error(`failed to scp scripts to ${server}`);
            }

            ns.print(`copied scripts to ${server}`);
        }

        this.sortBlocks();
    }

    /**
     * reserves resources for a task and executes it
     * MUST call finish() on all started tasks, otherwise memory will leak
     */
    public start(task: DispatchableTask, callbackPort: number, { dryRun = false } = {}): void {
        if (this.startedTasks.has(task.id)) {
            throw new Error(`task ${task.id} is already started`);
        }

        if (task.threads <= 0) {
            throw new Error(`task ${task.id} has invalid thread count ${task.threads}`);
        }

        const taskScript = TASK_SCRIPTS.get(task.taskType);
        const taskRamCost = task.threads * taskScript.cost;

        // we assume that blocks is sorted so this will find the smallest block that fits the task
        // we don't split a task across multiple blocks for simplicity and because some timing calculations
        // depend on the task being run with exactly as many threads per script as requested
        const block = this.blocks.find((block) => block.ram >= taskRamCost);
        if (!block) {
            this.ns.print(`current resource availability`);
            this.ns.print(JSON.stringify(this.blocks, null, 4));

            throw new Error(`couldn't find block for task ${JSON.stringify(task)}`);
        }

        const pid = dryRun
            ? null
            : this.ns.exec(
                  taskScript.path,
                  block.server,
                  task.threads,
                  task.id,
                  task.taskType,
                  task.target,
                  task.delayMs,
                  callbackPort,
              );

        if (pid === 0) {
            throw new Error(`failed to start task ${task.id}`);
        }

        this.ns.print(
            `started task ${task.id} on ${block.server} with ${task.threads} threads (pid ${pid})${dryRun ? ' (dry run)' : ''}'}`,
        );

        block.ram -= taskRamCost;

        this.startedTasks.set(task.id, { ramCost: taskRamCost, server: block.server, pid });

        // todo-performance: this might be a bit slow, faster would be to just insert the block
        //   at the right place
        this.sortBlocks();
    }

    /**
     * frees the resources allocated for a started task and kills the backing process if
     * it's still running
     */
    public finish(taskId: string): void {
        const startedTask = this.startedTasks.get(taskId);
        if (!startedTask) {
            throw new Error(`task ${taskId} has not been started`);
        }

        const block = this.blocks.find((block) => block.server === startedTask.server);
        if (!block) {
            throw new Error(`couldn't find block for started task ${startedTask}`);
        }

        block.ram += startedTask.ramCost;

        // usually this is called when we know the process is already dead, but just in case
        this.ns.kill(startedTask.pid);

        // todo-performance: see above
        this.sortBlocks();
    }

    private sortBlocks(): void {
        this.blocks.sort((a, b) => a.ram - b.ram);
    }
}

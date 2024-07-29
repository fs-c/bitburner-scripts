import { getAllServers } from './batcher/utils';

export async function main(ns: NS): Promise<void> {
    const servers = getAllServers(ns);

    for (const server of servers) {
        ns.killall(server, true);
    }
}

import { getAllServers } from './utils';

export async function main(ns: NS): Promise<void> {
    const allServers = getAllServers(ns);
    for (const server of allServers) {
        if (ns.hasRootAccess(server)) {
            continue;
        }

        const requiredPorts = ns.getServerNumPortsRequired(server);

        if (requiredPorts > 0) {
            ns.brutessh(server);
        }

        if (requiredPorts > 1) {
            ns.ftpcrack(server);
        }

        if (requiredPorts > 2) {
            ns.relaysmtp(server);
        }

        if (requiredPorts > 3) {
            ns.httpworm(server);
        }

        if (requiredPorts > 4) {
            ns.sqlinject(server);
        }

        if (requiredPorts > 5) {
            continue;
        }

        ns.nuke(server);

        ns.tprintf(`SUCCESS opened server ${server}`);
    }
}

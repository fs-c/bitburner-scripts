import { getAllServers } from './utils';

export async function main(ns: NS): Promise<void> {
    const allServers = getAllServers(ns);
    for (const server of allServers) {
        if (ns.hasRootAccess(server)) {
            continue;
        }

        const requiredPorts = ns.getServerNumPortsRequired(server);

        try {
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
        } catch (err) {
            ns.tprint(`WARN didn't fully open server ${server}: ${err}`);
        }

        try {
            ns.nuke(server);
            ns.tprintf(`SUCCESS opened server ${server}`);
        } catch (err) {
            ns.tprint(`WARN failed to nuke server ${server}: ${err}`);
        }
    }
}

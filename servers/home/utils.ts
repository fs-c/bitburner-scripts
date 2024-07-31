export function getAllServers(ns: NS): Set<string> {
    const allServers = new Set<string>();
    const queue = ['home'];

    while (true) {
        const current = queue.pop();
        if (current == null) {
            break;
        }

        allServers.add(current);

        const connectedServers = ns.scan(current);
        for (const connectedServer of connectedServers) {
            if (allServers.has(connectedServer)) {
                continue;
            }

            queue.push(connectedServer);
        }
    }

    const purchasedServers = ns.getPurchasedServers();
    for (const purchasedServer of purchasedServers) {
        allServers.add(purchasedServer);
    }

    return allServers;
}

export function isPrepped(ns: NS, server: string): boolean {
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

// this is a pseudo-random uuid-generator stolen from the internet but it's good enough for this
export function id(): string {
    let d = '';
    while (d.length < 32) d += Math.random().toString(16).slice(2);
    const vr = ((parseInt(d.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
    return `${d.slice(0, 8)}-${d.slice(8, 12)}-4${d.slice(13, 16)}-${vr}${d.slice(17, 20)}-${d.slice(20, 32)}`;
}

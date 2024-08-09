/** @param {NS} ns */
export async function main(ns: NS): Promise<void> {
    const [command = 'check'] = ns.args as [string];

    const totalServers = 25;
    const costPerRamGB = 55000;
    const maxPower = Math.log2(ns.getPurchasedServerMaxRam());
    const currentMoney = ns.getPlayer().money;

    let ramToBuy = 0;
    for (let i = 1; i <= maxPower; i++) {
        const ram = Math.pow(2, i);
        const cost = totalServers * ram * costPerRamGB;
        if (cost <= currentMoney) {
            ramToBuy = ram;
        } else {
            break; // not going to get cheaper
        }
    }

    const purchasedServers = ns.getPurchasedServers();
    const currentPurchasedServerRam =
        purchasedServers.length === 0 ? 0 : ns.getServerMaxRam(purchasedServers[0] as string);

    if (currentPurchasedServerRam >= ramToBuy) {
        ns.tprint(`not doing anything, ram to buy ${ramToBuy} is same or smaller than current`);
        return;
    }

    if (command === 'check') {
        ns.tprint(
            `INFO would upgrade servers from ${currentPurchasedServerRam}gb to ${ramToBuy}gb`,
        );

        const totalCost = ramToBuy * costPerRamGB * totalServers;
        const totalDeleted = purchasedServers.length * currentPurchasedServerRam * costPerRamGB;

        ns.tprint(
            `INFO this would cost ${ns.formatNumber(totalCost)}$ and delete ${ns.formatNumber(totalDeleted)}$ worth of servers`,
        );
    } else if (command === 'buy') {
        // delete all purchased servers
        for (const purchasedServer of purchasedServers) {
            ns.killall(purchasedServer);
            ns.deleteServer(purchasedServer);
            ns.tprint(`INFO deleted server ${purchasedServer} with ${currentPurchasedServerRam}gb`);
        }

        // and rebuy them (in a separate loop in case we didn't have 25 already)
        for (let i = 0; i < totalServers; i++) {
            const name = `pserv-${ramToBuy}-${i}`;
            ns.purchaseServer(name, ramToBuy);
            ns.tprint(`INFO purchased server ${name} with ${ramToBuy}gb`);
        }
    }
}

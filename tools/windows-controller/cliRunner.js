const WindowsController = require('./controller');

async function main() {
    const action = process.argv[2] || '--run-all';

    try {
        WindowsController.verifyTailscalePrerequisite();
        await WindowsController.ensureProxyRunning();

        if (action === '--test') {
            const res = await WindowsController.testTailscaleConnection();
            console.log(res.message);
            if (!res.success) process.exit(1);
            return;
        } else if (action === '--run-all') {
            const res = await WindowsController.startBot();
            console.log(res.message || 'Bot execution command sent to VPS');
        } else if (action === '--stop') {
            const res = await WindowsController.stopBot();
            console.log(res.message || 'Bot stopped on VPS');
        } else if (action === '--status') {
            const res = await WindowsController.getVPSStatus();
            console.log(res.data?.state || 'OK');
        } else if (action === '--sync') {
            const res = WindowsController.syncToVPS();
            console.log(res.message || 'Sync completed');
        } else if (action.startsWith('--run-account=')) {
            const email = action.split('=')[1];
            const res = await WindowsController.runSingleAccount(email);
            console.log(res.message || 'Account task completed');
        } else if (action.startsWith('--schedule=')) {
            const time = action.split('=')[1] || '07:30';
            const res = WindowsController.scheduleDailyTask(time);
            console.log(res.message || 'Schedule configured');
        } else {
            console.log('Invalid command');
        }
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

main();

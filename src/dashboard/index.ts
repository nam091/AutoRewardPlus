import { DashboardServer } from './server';
import { CLIInteractiveDashboard } from './tui';

const mode = process.argv.includes('--cli') ? 'cli' : 'web';

if (mode === 'cli') {
    const cli = new CLIInteractiveDashboard();
    cli.start();
} else {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT, 10) : 3000);
    const server = new DashboardServer();
    server.start(port);
}

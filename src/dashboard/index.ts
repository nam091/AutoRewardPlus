import { DashboardServer } from './server';
import { CLIInteractiveDashboard } from './tui';

const mode = process.argv.includes('--cli') ? 'cli' : 'web';

if (mode === 'cli') {
    const cli = new CLIInteractiveDashboard();
    cli.start();
} else {
    const server = new DashboardServer();
    server.start(3000);
}

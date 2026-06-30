import { google, sheets_v4 } from 'googleapis';
import fs from 'fs';
import path from 'path';

export interface SheetAccountRow {
    email: string;
    totalPoints: number | string;
    dailyPoints: number | string;
    pcProgress: string;
    mobileProgress: string;
    status: string;
    accountAge: string;
    updatedAt: string;
    streak?: string;
    onlineStatus?: string;
}

export class SheetService {
    private sheets: sheets_v4.Sheets | null = null;
    private spreadsheetId: string = '';
    private sheetName: string = 'Sheet1';
    private enabled: boolean = false;

    constructor() {
        this.loadConfig();
    }

    public loadConfig() {
        try {
            const configPath = path.resolve('src/config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                if (config.googleSheets && config.googleSheets.enabled) {
                    this.enabled = true;
                    this.spreadsheetId = config.googleSheets.spreadsheetId;
                    this.sheetName = config.googleSheets.sheetName || 'Sheet1';

                    const keyFile = path.resolve(config.googleSheets.keyFilePath || 'service-account.json');
                    if (fs.existsSync(keyFile)) {
                        const auth = new google.auth.GoogleAuth({
                            keyFile,
                            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                        });
                        this.sheets = google.sheets({ version: 'v4', auth });
                    }
                }
            }
        } catch (error) {
            console.error('[SheetService] Failed to load Google Sheets config:', error);
        }
    }

    public async syncAccountsToSheet(rows: SheetAccountRow[]): Promise<boolean> {
        if (!this.enabled || !this.sheets || !this.spreadsheetId) return false;

        try {
            const values = [
                ['Email', 'Điểm', 'Điểm ngày', 'PC', 'Mobile', 'Trạng thái', 'Tuổi acc', 'Cập nhật', 'Chuỗi', 'Trạng thái Online']
            ];

            for (const row of rows) {
                values.push([
                    row.email,
                    String(row.totalPoints || 0),
                    String(row.dailyPoints || 0),
                    row.pcProgress || '0/90',
                    row.mobileProgress || '0/60',
                    row.status || 'OK',
                    row.accountAge || 'N/A',
                    row.updatedAt || new Date().toLocaleString('vi-VN'),
                    row.streak || '0',
                    row.onlineStatus || 'OFFLINE'
                ]);
            }

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A1:J${values.length}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values }
            });

            return true;
        } catch (error) {
            console.error('[SheetService] Error updating sheet:', error);
            return false;
        }
    }

    public async pullAccountsFromSheet(): Promise<any[]> {
        if (!this.enabled || !this.sheets || !this.spreadsheetId) return [];

        try {
            const res = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A2:K`,
            });

            const rows = res.data.values || [];
            return rows.map(row => ({
                email: row[0] || '',
                password: row[10] || '', // Optional password column (column K)
                totalPoints: row[1] || 0,
                status: row[5] || 'UNKNOWN',
                onlineStatus: row[9] || 'OFFLINE'
            }));
        } catch (error) {
            console.error('[SheetService] Error reading sheet:', error);
            return [];
        }
    }
}

export const sheetService = new SheetService();

import { google, sheets_v4 } from 'googleapis'
import fs from 'fs'
import path from 'path'

import { resolveExecutionProfile } from '../browser/humanize/ExecutionProfile'
import { AccountService } from '../dashboard/accountService'
import { SessionService } from '../dashboard/sessionService'
import type { Account } from '../interface/Account'
import { stateService, type AccountState } from './stateService'

export interface SheetAccountRow {
    email: string
    totalPoints: number | string
    dailyPoints: number | string
    pcProgress: string
    mobileProgress: string
    status: string
    accountAge: string
    updatedAt: string
    streak?: string
    onlineStatus?: string
    tag?: string
    redemptionCount?: number | string
    executionMode?: string
    level?: string
    lifetimePoints?: number | string
    geoLocale?: string
    proxy?: string
    redeemGoalTitle?: string
    lastError?: string
}

export interface SyncAllFromDiskOptions {
    onlineEmails?: Set<string>
    sessionMap?: Map<string, { hasDesktop: boolean; hasMobile: boolean }>
    statsOverride?: SheetAccountRow[]
    client?: sheets_v4.Sheets
}

const MAIN_SHEET_HEADER = [
    'Email',
    'Tag',
    'Tuổi acc',
    'Quà đã đổi',
    'Chế độ',
    'Điểm',
    'Điểm ngày',
    'PC',
    'Mobile',
    'Trạng thái',
    'Level',
    'Tổng tích lũy',
    'Geo',
    'Proxy',
    'Cập nhật',
    'Chuỗi',
    'Online',
    'Mục tiêu',
    'Lỗi gần nhất'
]

const ACCOUNTS_INFO_HEADER = [
    'Email',
    'Password',
    'TOTP Secret',
    'Recovery Email',
    'Tag',
    'Enabled',
    'GeoLocale',
    'LangCode',
    'Proxy URL',
    'Proxy Port',
    'Proxy User',
    'Proxy Pass',
    'Tuổi acc',
    'Quà đã đổi',
    'Chế độ',
    'Level',
    'Điểm hiện tại',
    'Tổng tích lũy',
    'Mục tiêu',
    'Session',
    'Trạng thái',
    'Cập nhật',
    'Lỗi gần nhất'
]

function parseRedemptionNumber(value: number | string | undefined): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined
    }
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return undefined
        const parsed = Number(trimmed)
        return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined
    }
    return undefined
}

export class SheetService {
    private sheets: sheets_v4.Sheets | null = null
    private spreadsheetId = ''
    private sheetName = 'Sheet1'
    private accountsSheetName = 'Accounts_Info'
    private enabled = false
    public lastError: string | null = null

    constructor() {
        this.loadConfig()
    }

    public loadConfig(): void {
        try {
            const candidates = [
                process.env.CONFIG_PATH?.trim(),
                path.resolve('dist/config.json'),
                path.resolve('src/config.json')
            ].filter((c): c is string => Boolean(c))
            const configPath = candidates.find(c => fs.existsSync(c))

            this.enabled = false
            this.sheets = null
            this.spreadsheetId = ''
            this.sheetName = 'Sheet1'
            this.accountsSheetName = 'Accounts_Info'
            this.lastError = null

            if (!configPath) {
                this.lastError = 'Không tìm thấy file cấu hình config.json.'
                return
            }

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
                googleSheets?: {
                    enabled?: boolean
                    spreadsheetId?: string
                    sheetName?: string
                    accountsSheetName?: string
                    keyFilePath?: string
                }
            }

            if (!config.googleSheets || !config.googleSheets.enabled) {
                this.lastError = 'Google Sheets chưa được bật (googleSheets.enabled = false).'
                return
            }

            this.enabled = true
            this.spreadsheetId = String(config.googleSheets.spreadsheetId || '').trim()
            this.sheetName = String(config.googleSheets.sheetName || 'Sheet1').trim() || 'Sheet1'
            this.accountsSheetName =
                String(config.googleSheets.accountsSheetName || 'Accounts_Info').trim() || 'Accounts_Info'

            if (!this.spreadsheetId) {
                this.lastError = 'Thiếu googleSheets.spreadsheetId trong config.json.'
                return
            }

            const keyFile = path.resolve(config.googleSheets.keyFilePath || 'service-account.json')
            if (fs.existsSync(keyFile)) {
                const auth = new google.auth.GoogleAuth({
                    keyFile,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets']
                })
                this.sheets = google.sheets({ version: 'v4', auth })
                this.lastError = null
            } else {
                this.lastError = `Không tìm thấy file key Google Sheets: ${keyFile}`
            }
        } catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error)
            console.error('[SheetService] Failed to load Google Sheets config:', error)
        }
    }

    private formatTabPrefix(title: string): string {
        if (!/[^A-Za-z0-9_]/.test(title)) {
            return title
        }
        return `'${title.replace(/'/g, "''")}'`
    }

    private async ensureSheetTab(
        sheetsClient: sheets_v4.Sheets,
        spreadsheetId: string,
        title: string
    ): Promise<void> {
        const meta = await sheetsClient.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties.title'
        })
        const titles = (meta.data.sheets ?? [])
            .map(sheet => sheet.properties?.title)
            .filter((name): name is string => Boolean(name))

        if (!titles.includes(title)) {
            await sheetsClient.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{ addSheet: { properties: { title } } }]
                }
            })
        }
    }

    private async clearTrailingRows(
        sheetsClient: sheets_v4.Sheets,
        spreadsheetId: string,
        tabName: string,
        writtenRowCount: number
    ): Promise<void> {
        const startRow = Math.max(2, writtenRowCount + 1)
        await sheetsClient.spreadsheets.values.clear({
            spreadsheetId,
            range: `${this.formatTabPrefix(tabName)}!A${startRow}:Z1000`
        })
    }

    private async loadSessionMap(): Promise<Map<string, { hasDesktop: boolean; hasMobile: boolean }>> {
        const map = new Map<string, { hasDesktop: boolean; hasMobile: boolean }>()
        try {
            const entries = await new SessionService().list()
            for (const entry of entries) {
                map.set(entry.account.toLowerCase(), {
                    hasDesktop: entry.hasDesktop,
                    hasMobile: entry.hasMobile
                })
            }
        } catch {
            // Best-effort session presence scan
        }
        return map
    }

    private buildMainTabValues(
        accounts: Account[],
        states: AccountState[],
        statsOverride: SheetAccountRow[],
        onlineEmails: Set<string>
    ): string[][] {
        const accountMap = new Map(accounts.map(acc => [acc.email.toLowerCase(), acc]))
        const stateMap = new Map(states.map(st => [st.email.toLowerCase(), st]))
        const overrideMap = new Map(statsOverride.map(row => [row.email.toLowerCase(), row]))

        const orderedKeys: string[] = []
        const seen = new Set<string>()
        const pushKey = (email: string) => {
            const key = email.trim().toLowerCase()
            if (!key || seen.has(key)) return
            seen.add(key)
            orderedKeys.push(key)
        }

        for (const acc of accounts) pushKey(acc.email)
        for (const st of states) pushKey(st.email)
        for (const row of statsOverride) pushKey(row.email)

        const values: string[][] = [MAIN_SHEET_HEADER]

        for (const key of orderedKeys) {
            const acc = accountMap.get(key)
            const st = stateMap.get(key)
            const ovr = overrideMap.get(key)

            const email = ovr?.email || acc?.email || st?.email || ''
            const tag = ovr?.tag ?? acc?.tag ?? st?.tag ?? ''
            const redemptionNum = parseRedemptionNumber(
                ovr?.redemptionCount !== undefined && ovr.redemptionCount !== ''
                    ? ovr.redemptionCount
                    : st?.redemptionCount
            )
            const redemptionDisplay = redemptionNum !== undefined ? String(redemptionNum) : ''
            const executionMode =
                ovr?.executionMode || resolveExecutionProfile({ tag, redemptionCount: redemptionNum }).mode

            const accProxy = acc?.proxy?.url ? `${acc.proxy.url}:${acc.proxy.port || 0}` : ''
            const proxy = ovr?.proxy || accProxy || st?.proxy || 'Direct'
            const isOnline = onlineEmails.has(key) || st?.status === 'RUNNING'
            const onlineStatus = ovr?.onlineStatus || (isOnline ? 'ONLINE' : 'OFFLINE')

            values.push([
                email,
                tag,
                ovr?.accountAge || st?.accountAge || 'N/A',
                redemptionDisplay,
                executionMode,
                String(ovr?.totalPoints ?? st?.totalPoints ?? 0),
                String(ovr?.dailyPoints ?? st?.dailyPoints ?? 0),
                ovr?.pcProgress || st?.pcProgress || '0/90',
                ovr?.mobileProgress || st?.mobileProgress || '0/60',
                ovr?.status || st?.status || 'IDLE',
                ovr?.level || st?.level || 'Level 1',
                String(ovr?.lifetimePoints ?? st?.lifetimePoints ?? 0),
                ovr?.geoLocale || acc?.geoLocale || st?.geoLocale || 'vn',
                proxy,
                ovr?.updatedAt || st?.updatedAt || new Date().toLocaleString('vi-VN'),
                ovr?.streak || st?.streak || '0',
                onlineStatus,
                ovr?.redeemGoalTitle || st?.redeemGoalTitle || 'None',
                ovr?.lastError ?? st?.lastError ?? ''
            ])
        }

        return values
    }

    private buildAccountsInfoTabValues(
        accounts: Account[],
        states: AccountState[],
        statsOverride: SheetAccountRow[],
        sessionMap: Map<string, { hasDesktop: boolean; hasMobile: boolean }>
    ): string[][] {
        const stateMap = new Map(states.map(st => [st.email.toLowerCase(), st]))
        const overrideMap = new Map(statsOverride.map(row => [row.email.toLowerCase(), row]))

        const values: string[][] = [ACCOUNTS_INFO_HEADER]

        for (const acc of accounts) {
            const key = acc.email.toLowerCase()
            const st = stateMap.get(key)
            const ovr = overrideMap.get(key)
            const sess = sessionMap.get(key)
            const sessionLabel =
                sess?.hasDesktop && sess?.hasMobile
                    ? 'D+M'
                    : sess?.hasDesktop
                      ? 'D'
                      : sess?.hasMobile
                        ? 'M'
                        : 'None'

            const tag = acc.tag ?? ovr?.tag ?? st?.tag ?? ''
            const redemptionNum = parseRedemptionNumber(
                ovr?.redemptionCount !== undefined && ovr.redemptionCount !== ''
                    ? ovr.redemptionCount
                    : st?.redemptionCount
            )
            const redemptionDisplay = redemptionNum !== undefined ? String(redemptionNum) : ''
            const executionMode =
                ovr?.executionMode || resolveExecutionProfile({ tag, redemptionCount: redemptionNum }).mode

            values.push([
                acc.email,
                acc.password || '',
                acc.totpSecret || acc.totp || '',
                acc.recoveryEmail || '',
                tag,
                acc.enabled !== false ? 'TRUE' : 'FALSE',
                acc.geoLocale || 'vn',
                acc.langCode || 'vi',
                acc.proxy?.url || '',
                String(acc.proxy?.port ?? 0),
                acc.proxy?.username || '',
                acc.proxy?.password || '',
                ovr?.accountAge || st?.accountAge || 'N/A',
                redemptionDisplay,
                executionMode,
                ovr?.level || st?.level || 'Level 1',
                String(ovr?.totalPoints ?? st?.totalPoints ?? 0),
                String(ovr?.lifetimePoints ?? st?.lifetimePoints ?? 0),
                ovr?.redeemGoalTitle || st?.redeemGoalTitle || 'None',
                sessionLabel,
                ovr?.status || st?.status || 'IDLE',
                ovr?.updatedAt || st?.updatedAt || new Date().toLocaleString('vi-VN'),
                ovr?.lastError ?? st?.lastError ?? ''
            ])
        }

        return values
    }

    public async syncAllFromDisk(options: SyncAllFromDiskOptions = {}): Promise<boolean> {
        this.loadConfig()
        const sheetsClient = options.client ?? this.sheets

        if (!this.enabled) {
            return false
        }
        if (!this.spreadsheetId) {
            this.lastError = 'Thiếu googleSheets.spreadsheetId trong config.json.'
            return false
        }
        if (!sheetsClient) {
            if (!this.lastError) {
                this.lastError = 'Chưa khởi tạo được Google Sheets client (thiếu file key service-account).'
            }
            return false
        }

        this.lastError = null

        try {
            const accounts = new AccountService().readRawAccounts()
            const states = stateService.getStates()
            const sessionMap = options.sessionMap ?? (await this.loadSessionMap())
            const onlineEmails = new Set(
                Array.from(options.onlineEmails ?? []).map(email => email.trim().toLowerCase())
            )
            const statsOverride = options.statsOverride ?? []

            const mainValues = this.buildMainTabValues(accounts, states, statsOverride, onlineEmails)
            await this.ensureSheetTab(sheetsClient, this.spreadsheetId, this.sheetName)
            await sheetsClient.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${this.formatTabPrefix(this.sheetName)}!A1:S${mainValues.length}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: mainValues }
            })
            await this.clearTrailingRows(sheetsClient, this.spreadsheetId, this.sheetName, mainValues.length)

            if (this.accountsSheetName !== this.sheetName) {
                const infoValues = this.buildAccountsInfoTabValues(accounts, states, statsOverride, sessionMap)
                await this.ensureSheetTab(sheetsClient, this.spreadsheetId, this.accountsSheetName)
                await sheetsClient.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: `${this.formatTabPrefix(this.accountsSheetName)}!A1:W${infoValues.length}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: infoValues }
                })
                await this.clearTrailingRows(
                    sheetsClient,
                    this.spreadsheetId,
                    this.accountsSheetName,
                    infoValues.length
                )
            }

            return true
        } catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error)
            console.error('[SheetService] Error updating sheet:', error)
            return false
        }
    }

    public async syncAccountsToSheet(rows: SheetAccountRow[]): Promise<boolean> {
        return this.syncAllFromDisk({ statsOverride: rows })
    }

    public async pullAccountsFromSheet(): Promise<
        Array<{
            email: string
            password: string
            totalPoints: string | number
            status: string
            onlineStatus: string
        }>
    > {
        this.loadConfig()
        if (!this.enabled || !this.sheets || !this.spreadsheetId) return []

        try {
            const res = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.formatTabPrefix(this.sheetName)}!A2:S`
            })

            const rows = res.data.values || []
            return rows.map(row => ({
                email: String(row[0] ?? ''),
                password: '',
                totalPoints: (row[5] as string | number | undefined) ?? 0,
                status: String(row[9] ?? 'UNKNOWN'),
                onlineStatus: String(row[16] ?? 'OFFLINE')
            }))
        } catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error)
            console.error('[SheetService] Error reading sheet:', error)
            return []
        }
    }
}

export const sheetService = new SheetService()

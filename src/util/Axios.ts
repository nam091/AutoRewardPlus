import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import axiosRetry from 'axios-retry'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { URL } from 'url'
import type { AccountProxy } from '../interface/Account'

export function getRetryDelayMs(retryCount: number, retryAfter: unknown): number {
    const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter
    if (typeof raw === 'string' && raw.trim()) {
        const seconds = Number(raw)
        const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now()
        if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, 5 * 60 * 1000)
    }
    return Math.min(1000 * 2 ** Math.max(0, retryCount - 1), 60000) + Math.floor(Math.random() * 500)
}

class AxiosClient {
    private instance: AxiosInstance
    private directInstance: AxiosInstance
    private account: AccountProxy

    constructor(account: AccountProxy) {
        this.account = account

        this.instance = axios.create({
            timeout: 20000
        })
        this.directInstance = axios.create({ timeout: 20000 })

        if (this.account.url && this.account.proxyAxios) {
            const { httpAgent, httpsAgent } = this.getAgentsForProxy(this.account)
            this.instance.defaults.httpAgent = httpAgent
            this.instance.defaults.httpsAgent = httpsAgent
        }

        const retryOptions = {
            retries: 5,
            retryDelay: (retryCount: number, error: AxiosError) =>
                getRetryDelayMs(retryCount, error.response?.headers['retry-after']),
            shouldResetTimeout: true,
            retryCondition: (error: AxiosError) => {
                if (axiosRetry.isNetworkError(error)) return true
                if (!error.response) return true

                const status = error.response.status
                return status === 429 || (status >= 500 && status <= 599)
            }
        }
        axiosRetry(this.instance, retryOptions)
        axiosRetry(this.directInstance, retryOptions)
    }

    private getAgentsForProxy(
        proxyConfig: AccountProxy
    ): {
        httpAgent: HttpProxyAgent<string> | SocksProxyAgent
        httpsAgent: HttpsProxyAgent<string> | SocksProxyAgent
    } {
        const { url: baseUrl, port, username, password } = proxyConfig

        let urlObj: URL
        try {
            urlObj = new URL(baseUrl)
        } catch (e) {
            try {
                urlObj = new URL(`http://${baseUrl}`)
            } catch (error) {
                throw new Error(`Invalid proxy URL format: ${baseUrl}`)
            }
        }

        const protocol = urlObj.protocol.toLowerCase()
        let proxyUrl: string

        if (username && password) {
            urlObj.username = encodeURIComponent(username)
            urlObj.password = encodeURIComponent(password)
            urlObj.port = port.toString()
            proxyUrl = urlObj.toString()
        } else {
            proxyUrl = `${protocol}//${urlObj.hostname}:${port}`
        }

        if (protocol.startsWith('socks')) {
            const agent = new SocksProxyAgent(proxyUrl)
            return { httpAgent: agent, httpsAgent: agent }
        }

        return {
            httpAgent: new HttpProxyAgent(proxyUrl),
            httpsAgent: new HttpsProxyAgent(proxyUrl)
        }
    }

    public async request(config: AxiosRequestConfig, bypassProxy = false): Promise<AxiosResponse> {
        if (bypassProxy) {
            return this.directInstance.request(config)
        }

        return this.instance.request(config)
    }
}

export default AxiosClient

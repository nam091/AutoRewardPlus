const assert = require('node:assert/strict')
const test = require('node:test')

process.env.DASHBOARD_API_TOKEN = 'test-dashboard-token'
process.env.DASHBOARD_HOST = '127.0.0.1'

const { DashboardServer } = require('../dist/dashboard/server')

test('dashboard protects API routes with bearer token', async () => {
    const dashboard = new DashboardServer()
    const unauthorized = await dashboard.app.inject({ method: 'GET', url: '/api/status' })
    assert.equal(unauthorized.statusCode, 401)

    const authorized = await dashboard.app.inject({
        method: 'GET',
        url: '/api/status',
        headers: { authorization: 'Bearer test-dashboard-token' }
    })
    assert.equal(authorized.statusCode, 200)
    assert.equal(JSON.parse(authorized.body).success, true)
    await dashboard.close()
})

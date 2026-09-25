const { chromium } = require('patchright');

async function debugLogin() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://login.live.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const emailInput = await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await emailInput.fill('nammw927@gmail.com');
    await page.waitForTimeout(500);
    
    // Click Next button
    const nextBtn = await page.waitForSelector('button[type="submit"], input[type="submit"], #idSIButton9', { timeout: 5000 });
    console.log('Found next button:', await nextBtn.evaluate(el => el.outerHTML));
    await nextBtn.click();
    await page.waitForTimeout(3000);

    console.log('Current URL:', page.url());
    const bodyText = await page.innerText('body');
    console.log('Body snippet:', bodyText.substring(0, 300));
    await browser.close();
}

debugLogin();

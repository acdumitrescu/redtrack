const puppeteer = require('puppeteer');
const crypto = require('crypto');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });

  console.log('Navigating to dashboard...');
  await page.goto('http://localhost:3000/?u=spez', { waitUntil: 'networkidle2' });
  
  // Wait for profile header
  await page.waitForSelector('#profile-header', { timeout: 10000 }).catch(() => {});
  
  // Wait extra time for the graph to generate now that it's limited to 100
  await new Promise(r => setTimeout(r, 6000));
  
  await page.screenshot({ path: 'docs/demo_dashboard.png', fullPage: true });
  console.log('Saved docs/demo_dashboard.png');

  console.log('Navigating to admin...');
  // Inject cookie for admin
  const hashedPw = crypto.createHash('sha256').update('redtrack123').digest('hex');
  await page.setCookie({
    name: 'redtrack_session',
    value: hashedPw,
    domain: 'localhost',
    path: '/',
    httpOnly: true
  });
  
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle2' });
  await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  
  await page.screenshot({ path: 'docs/demo_admin.png', fullPage: true });
  console.log('Saved docs/demo_admin.png');

  await browser.close();
})();

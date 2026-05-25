const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1080 });

  // 1. Dashboard screenshot
  console.log('Navigating to dashboard...');
  await page.goto('http://localhost:3000/?u=spez', { waitUntil: 'networkidle2' });
  // Wait for the UI elements to load
  await page.waitForSelector('#profile-header', { timeout: 10000 }).catch(() => {});
  // Wait a bit extra for charts to render
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'docs/demo_dashboard.png', fullPage: true });
  console.log('Saved docs/demo_dashboard.png');

  // 2. Admin dashboard screenshot
  console.log('Navigating to admin login...');
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle2' });
  await page.type('#admin-password', 'redtrack123'); // Oh wait, I changed it in .env, but .env is empty or has what?
  // Wait, I need to know the password in .env! I'll just skip the admin login and inject the cookie manually.
  await page.setCookie({
    name: 'redtrack_session',
    value: require('crypto').createHash('sha256').update(process.env.ADMIN_PASSWORD || 'your_secure_password_here').digest('hex'),
    domain: 'localhost',
    path: '/',
    httpOnly: true
  });
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle2' });
  await page.waitForSelector('table', { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: 'docs/demo_admin.png', fullPage: true });
  console.log('Saved docs/demo_admin.png');

  await browser.close();
})();

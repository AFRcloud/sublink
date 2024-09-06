import { ConfigBuilder } from './SingboxConfigBuilder.js';
import { generateHtml } from './htmlBuilder.js';
import { ClashConfigBuilder } from './ClashConfigBuilder.js';
import { encodeBase64, GenerateWebPath } from './utils.js';
import { PREDEFINED_RULE_SETS } from './config.js';

// Menambahkan event listener untuk menangani permintaan HTTP
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// Fungsi utama yang menangani berbagai jenis request
async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    switch (path) {
      case '/':
        if (method === 'GET') {
          // Tampilkan form HTML kosong untuk GET request
          return new Response(generateHtml('', '', ''), {
            headers: { 'Content-Type': 'text/html' }
          });
        } else if (method === 'POST') {
          // Tangani POST request dan form data
          const formData = await request.formData();
          const inputString = formData.get('input');
          const selectedRules = formData.getAll('selectedRules');
          const customRuleDomains = formData.getAll('customRuleSite[]');
          const customRuleIPs = formData.getAll('customRuleIP[]');
          const customRuleNames = formData.getAll('customRuleName[]');

          // Buat array custom rules berdasarkan domain, IP, dan nama
          const customRules = customRuleDomains.map((domains, index) => ({
            sites: domains.split(',').map(site => site.trim()),
            ips: customRuleIPs[index].split(',').map(ip => ip.trim()),
            outbound: customRuleNames[index]
          }));

          if (!inputString) {
            return new Response('Missing input parameter', { status: 400 });
          }

          // Atur default rules jika tidak ada yang dipilih
          const rulesToUse = selectedRules.length > 0 ? selectedRules : ['广告拦截', '谷歌服务', '国外媒体', '电报消息'];

          // Buat URL untuk Xray, Singbox, dan Clash
          const xrayUrl = `${url.origin}/xray?config=${encodeURIComponent(inputString)}`;
          const singboxUrl = `${url.origin}/singbox?config=${encodeURIComponent(inputString)}&selectedRules=${encodeURIComponent(JSON.stringify(rulesToUse))}&customRules=${encodeURIComponent(JSON.stringify(customRules))}`;
          const clashUrl = `${url.origin}/clash?config=${encodeURIComponent(inputString)}&selectedRules=${encodeURIComponent(JSON.stringify(rulesToUse))}&customRules=${encodeURIComponent(JSON.stringify(customRules))}`;

          // Kembalikan HTML dengan hasil URL konfigurasi
          return new Response(generateHtml(xrayUrl, singboxUrl, clashUrl), {
            headers: { 'Content-Type': 'text/html' }
          });
        }
        break;

      case '/singbox':
      case '/clash':
        // Menangani konfigurasi Singbox atau Clash
        const inputString = url.searchParams.get('config');
        let selectedRules = url.searchParams.get('selectedRules');
        let customRules = url.searchParams.get('customRules');

        if (!inputString) {
          return new Response('Missing config parameter', { status: 400 });
        }

        // Atur predefined rules atau parsing dari request
        if (PREDEFINED_RULE_SETS[selectedRules]) {
          selectedRules = PREDEFINED_RULE_SETS[selectedRules];
        } else {
          try {
            selectedRules = JSON.parse(decodeURIComponent(selectedRules));
          } catch (error) {
            console.error('Error parsing selectedRules:', error);
            selectedRules = PREDEFINED_RULE_SETS.minimal;
          }
        }

        // Parsing custom rules dari request
        try {
          customRules = JSON.parse(decodeURIComponent(customRules));
        } catch (error) {
          console.error('Error parsing customRules:', error);
          customRules = [];
        }

        let configBuilder;
        if (path === '/singbox') {
          configBuilder = new ConfigBuilder(inputString, selectedRules, customRules);
        } else {
          configBuilder = new ClashConfigBuilder(inputString, selectedRules, customRules);
        }

        // Bangun konfigurasi berdasarkan builder
        const config = await configBuilder.build();

        return new Response(
          path === '/singbox' ? JSON.stringify(config, null, 2) : config,
          {
            headers: { 
              'content-type': path === '/singbox' 
                ? 'application/json; charset=utf-8' 
                : 'text/yaml; charset=utf-8' 
            }
          }
        );

      case '/shorten':
        // Menangani pembuatan short URL
        const originalUrl = url.searchParams.get('url');
        if (!originalUrl) {
          return new Response('Missing URL parameter', { status: 400 });
        }

        // Generate short URL dan simpan ke KV
        const shortCode = GenerateWebPath();
        await SUBLINK_KV.put(shortCode, originalUrl);

        const shortUrl = `${url.origin}/s/${shortCode}`;
        return new Response(JSON.stringify({ shortUrl }), {
          headers: { 'Content-Type': 'application/json' }
        });

      case `/s/${url.pathname.split('/')[2]}`:
        // Menangani redirect short URL
        const shortCode = url.pathname.split('/')[2];
        const redirectUrl = await SUBLINK_KV.get(shortCode);

        if (redirectUrl === null) {
          return new Response('Short URL not found', { status: 404 });
        }

        return Response.redirect(redirectUrl, 302);

      case '/xray':
        // Encode konfigurasi untuk Xray
        const configParam = url.searchParams.get('config');
        if (!configParam) {
          return new Response('Missing config parameter', { status: 400 });
        }

        // Encode ke Base64 dan kembalikan sebagai JSON
        return new Response(encodeBase64(configParam), {
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });

      case '/favicon.ico':
        // Redirect untuk favicon
        return Response.redirect('https://cravatar.cn/avatar/9240d78bbea4cf05fb04f2b86f22b18d?s=160&d=retro&r=g', 301);

      default:
        // Menangani 404 Not Found jika path tidak dikenali
        return new Response('Not Found', { status: 404 });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

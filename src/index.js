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

    // Jika metode request adalah GET dan path adalah '/', tampilkan form HTML kosong
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(generateHtml('', '', ''), {
        headers: { 'Content-Type': 'text/html' }
      });
      
    // Jika metode request adalah POST dan path adalah '/', proses form data
    } else if (request.method === 'POST' && url.pathname === '/') {
      const formData = await request.formData();
      const inputString = formData.get('input'); // Mengambil input dari form
      const selectedRules = formData.getAll('selectedRules'); // Mengambil rules yang dipilih
      const customRuleDomains = formData.getAll('customRuleSite[]'); // Mengambil domain custom rules
      const customRuleIPs = formData.getAll('customRuleIP[]'); // Mengambil IP custom rules
      const customRuleNames = formData.getAll('customRuleName[]'); // Mengambil nama custom rules
      
      // Membuat array custom rules dengan memetakan domain, IP, dan nama
      const customRules = customRuleDomains.map((domains, index) => ({
        sites: domains.split(',').map(site => site.trim()),
        ips: customRuleIPs[index].split(',').map(ip => ip.trim()),
        outbound: customRuleNames[index]
      }));

      // Jika tidak ada input, kembalikan respon error
      if (!inputString) {
        return new Response('Missing input parameter', { status: 400 });
      }

      // Jika tidak ada rules yang dipilih, gunakan rules default
      const rulesToUse = selectedRules.length > 0 ? selectedRules : ['广告拦截', '谷歌服务', '国外媒体', '电报消息'];

      // Membuat URL untuk Xray, Singbox, dan Clash dengan encode input
      const xrayUrl = `${url.origin}/xray?config=${encodeURIComponent(inputString)}`;
      const singboxUrl = `${url.origin}/singbox?config=${encodeURIComponent(inputString)}&selectedRules=${encodeURIComponent(JSON.stringify(rulesToUse))}&customRules=${encodeURIComponent(JSON.stringify(customRules))}`;
      const clashUrl = `${url.origin}/clash?config=${encodeURIComponent(inputString)}&selectedRules=${encodeURIComponent(JSON.stringify(rulesToUse))}&customRules=${encodeURIComponent(JSON.stringify(customRules))}`;

      // Kembalikan HTML dengan URL hasil konfigurasi
      return new Response(generateHtml(xrayUrl, singboxUrl, clashUrl), {
        headers: { 'Content-Type': 'text/html' }
      });
      
    // Jika path adalah '/singbox' atau '/clash', proses konfigurasi sesuai dengan path
    } else if (url.pathname.startsWith('/singbox') || url.pathname.startsWith('/clash')) {
      const inputString = url.searchParams.get('config');
      let selectedRules = url.searchParams.get('selectedRules');
      let customRules = url.searchParams.get('customRules');

      // Jika inputString tidak ada, kembalikan respon error
      if (!inputString) {
        return new Response('Missing config parameter', { status: 400 });
      }

      // Jika ada predefined rules, gunakan itu, jika tidak parsing manual
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

      // Parsing custom rules
      try {
        customRules = JSON.parse(decodeURIComponent(customRules));
      } catch (error) {
        console.error('Error parsing customRules:', error);
        customRules = [];
      }

      // Memilih builder sesuai path (Singbox atau Clash)
      let configBuilder;
      if (url.pathname.startsWith('/singbox')) {
        configBuilder = new ConfigBuilder(inputString, selectedRules, customRules);
      } else {
        configBuilder = new ClashConfigBuilder(inputString, selectedRules, customRules);
      }

      // Membuat konfigurasi
      const config = await configBuilder.build();

      // Mengembalikan konfigurasi dalam format JSON atau YAML tergantung pada path
      return new Response(
        url.pathname.startsWith('/singbox') ? JSON.stringify(config, null, 2) : config,
        {
          headers: { 
            'content-type': url.pathname.startsWith('/singbox') 
              ? 'application/json; charset=utf-8' 
              : 'text/yaml; charset=utf-8' 
          }
        }
      );

    // Jika path adalah '/shorten', proses untuk membuat short URL
    } else if (url.pathname === '/shorten') {
      const originalUrl = url.searchParams.get('url');
      if (!originalUrl) {
        return new Response('Missing URL parameter', { status: 400 });
      }

      // Membuat short URL dan menyimpannya di KV Storage
      const shortCode = GenerateWebPath();
      await SUBLINK_KV.put(shortCode, originalUrl);

      const shortUrl = `${url.origin}/s/${shortCode}`;
      return new Response(JSON.stringify({ shortUrl }), {
        headers: { 'Content-Type': 'application/json' }
      });

    // Jika path dimulai dengan '/s/', lakukan redirect ke original URL
    } else if (url.pathname.startsWith('/s/')) {
      const shortCode = url.pathname.split('/')[2];
      const originalUrl = await SUBLINK_KV.get(shortCode);

      if (originalUrl === null) {
        return new Response('Short URL not found', { status: 404 });
      }

      // Redirect ke original URL
      return Response.redirect(originalUrl, 302);

    // Jika path adalah '/xray', encode konfigurasi ke Base64
    } else if (url.pathname.startsWith('/xray')) {
      const inputString = url.searchParams.get('config');

      if (!inputString) {
        return new Response('Missing config parameter', { status: 400 });
      }

      // Encode ke Base64 dan mengembalikan sebagai respon
      return new Response(encodeBase64(inputString), {
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });

    // Redirect untuk favicon
    } else if (url.pathname === '/favicon.ico') {
      return Response.redirect('https://cravatar.cn/avatar/9240d78bbea4cf05fb04f2b86f22b18d?s=160&d=retro&r=g', 301);
    }

    // Jika path tidak ditemukan, kembalikan 404
    return new Response('Not Found', { status: 404 });
  } catch (error) {
    // Menangani error dan mengembalikan 500
    console.error('Error processing request:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

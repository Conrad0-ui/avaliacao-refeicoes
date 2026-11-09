(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const CRITERIOS = [["sabor", "Sabor"], ["qualidade", "Qualidade"]];
  const TZ = "America/Sao_Paulo";
  const nf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  if (!window.supabase || !cfg.supabaseUrl || cfg.supabaseUrl.includes("SEU-PROJETO")) {
    document.querySelector(".wrap").innerHTML =
      '<p class="error">Configure o arquivo config.js com os dados do Supabase antes de usar o painel.</p>';
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  let linhas = [];
  let mostrados = 0;
  const PASSO = 20;

  const views = ["login", "noaccess", "dash"];
  const mostrar = (v) => views.forEach((n) => { $(`#view-${n}`).hidden = n !== v; });

  /* ---------- Autenticação ---------- */
  async function iniciar() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return mostrar("login");
    const { data: adm, error } = await sb.from("admins").select("user_id")
      .eq("user_id", data.session.user.id).maybeSingle();
    if (error || !adm) return mostrar("noaccess");
    mostrar("dash");
    prepararQR();
    carregar();
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-btn"), err = $("#login-error");
    err.hidden = true;
    btn.disabled = true; btn.textContent = "Entrando…";
    const { error } = await sb.auth.signInWithPassword({
      email: $("#email").value.trim(), password: $("#senha").value
    });
    btn.disabled = false; btn.textContent = "Entrar";
    if (error) {
      err.textContent = "E-mail ou senha incorretos.";
      err.hidden = false;
      return;
    }
    $("#senha").value = "";
    iniciar();
  });

  document.querySelectorAll("[data-logout]").forEach((b) =>
    b.addEventListener("click", async () => { await sb.auth.signOut(); linhas = []; mostrar("login"); }));

  /* ---------- Período ---------- */
  const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const deInput = (v) => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d); };
  const isoData = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function intervalo() {
    const p = $("#periodo").value;
    const hoje = inicioDoDia(new Date());
    if (p === "tudo") return { inicio: null, fim: null };
    if (p === "custom") {
      const de = $("#de").value, ate = $("#ate").value;
      const fim = ate ? deInput(ate) : null;
      if (fim) fim.setDate(fim.getDate() + 1);
      return { inicio: de ? deInput(de) : null, fim };
    }
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - (Number(p) - 1));
    return { inicio, fim: null };
  }

  $("#periodo").addEventListener("change", () => {
    const custom = $("#periodo").value === "custom";
    $("#lbl-de").hidden = !custom; $("#lbl-ate").hidden = !custom;
    if (custom && !$("#de").value) {
      const h = new Date(); $("#ate").value = isoData(h);
      h.setDate(h.getDate() - 29); $("#de").value = isoData(h);
    }
    carregar();
  });
  $("#de").addEventListener("change", carregar);
  $("#ate").addEventListener("change", carregar);

  /* ---------- Dados ---------- */
  async function buscar({ inicio, fim }) {
    const todas = [];
    const PAG = 1000;
    for (let de = 0; ; de += PAG) {
      let q = sb.from("avaliacoes")
        .select("nota_geral,sabor,temperatura,aparencia,qualidade,variedade,observacao,criado_em")
        .order("criado_em", { ascending: false })
        .range(de, de + PAG - 1);
      if (inicio) q = q.gte("criado_em", inicio.toISOString());
      if (fim) q = q.lt("criado_em", fim.toISOString());
      const { data, error } = await q;
      if (error) throw error;
      todas.push(...data);
      if (data.length < PAG) break;
    }
    return todas;
  }

  let pedido = 0;
  async function carregar() {
    const meu = ++pedido;
    $("#status").textContent = "Carregando…";
    try {
      const dados = await buscar(intervalo());
      if (meu !== pedido) return;
      linhas = dados;
      renderizar();
      $("#status").textContent = "";
    } catch (e) {
      if (meu !== pedido) return;
      $("#status").textContent = "Não foi possível carregar os dados. Verifique a conexão e tente de novo.";
    }
  }

  const media = (k) => { const v = linhas.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };

  function barra(rotulo, pct, valor) {
    return `<div class="bar-row"><span>${rotulo}</span>` +
      `<div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>` +
      `<span class="bar-val">${valor}</span></div>`;
  }

  function renderizar() {
    $("#resultados").hidden = false;
    $("#total").textContent = linhas.length.toLocaleString("pt-BR");

    if (!linhas.length) {
      $("#media-geral").textContent = "–";
      $("#medias").innerHTML = "";
      $("#distribuicao").innerHTML = "";
      $("#comentarios").innerHTML = '<li class="empty" style="border:0;background:none;padding:0">Nenhuma avaliação neste período.</li>';
      $("#mais").hidden = true;
      return;
    }

    $("#media-geral").textContent = nf.format(media("nota_geral"));
    $("#medias").innerHTML = CRITERIOS.map(([k, n]) => {
      const m = media(k);
      return barra(n, (m / 5) * 100, nf.format(m));
    }).join("");

    const cont = [0, 0, 0, 0, 0, 0];
    linhas.forEach((r) => cont[r.nota_geral]++);
    const max = Math.max(...cont.slice(1), 1);
    $("#distribuicao").innerHTML = [5, 4, 3, 2, 1].map((n) =>
      barra(`${n} ${n === 1 ? "estrela" : "estrelas"}`, (cont[n] / max) * 100, cont[n])).join("");

    $("#comentarios").innerHTML = "";
    mostrados = 0;
    maisComentarios();
  }

  const comObs = () => linhas.filter((r) => r.observacao);
  const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });

  function maisComentarios() {
    const lista = comObs();
    const ul = $("#comentarios");
    if (!lista.length) {
      ul.innerHTML = '<li class="empty" style="border:0;background:none;padding:0">Nenhuma observação neste período.</li>';
      $("#mais").hidden = true;
      return;
    }
    lista.slice(mostrados, mostrados + PASSO).forEach((r) => {
      const li = document.createElement("li");
      const meta = document.createElement("div");
      meta.className = "meta";
      const quando = document.createElement("span");
      quando.textContent = dataHora(r.criado_em);
      const nota = document.createElement("span");
      nota.className = "rate";
      nota.textContent = "★".repeat(r.nota_geral) + "☆".repeat(5 - r.nota_geral);
      nota.setAttribute("aria-label", `Nota geral ${r.nota_geral} de 5`);
      meta.append(quando, nota);
      const p = document.createElement("p");
      p.textContent = r.observacao; // textContent evita injeção de HTML
      li.append(meta, p);
      ul.append(li);
    });
    mostrados += PASSO;
    $("#mais").hidden = mostrados >= lista.length;
  }
  $("#mais").addEventListener("click", maisComentarios);

  /* ---------- Exportação CSV (abre no Excel) ---------- */
  function celula(v) {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas maliciosas no Excel
    return `"${s.replace(/"/g, '""')}"`;
  }

  $("#exportar").addEventListener("click", () => {
    if (!linhas.length) { $("#status").textContent = "Não há avaliações no período para exportar."; return; }
    const cab = ["Data", "Hora", "Nota geral", ...CRITERIOS.map(([, n]) => n), "Observação"];
    const corpo = linhas.map((r) => {
      const d = new Date(r.criado_em);
      const data = d.toLocaleDateString("pt-BR", { timeZone: TZ });
      const hora = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
      return [data, hora, r.nota_geral, ...CRITERIOS.map(([k]) => r[k]), r.observacao]
        .map(celula).join(";");
    });
    const csv = "\uFEFF" + [cab.map(celula).join(";"), ...corpo].join("\r\n");
    const { inicio, fim } = intervalo();
    const nome = `avaliacoes_${inicio ? isoData(inicio) : "inicio"}_a_${fim ? isoData(new Date(fim - 1)) : isoData(new Date())}.csv`;
    baixar(new Blob([csv], { type: "text/csv;charset=utf-8" }), nome);
  });

  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nome;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- QR Code ---------- */
  function prepararQR() {
    const input = $("#qr-url");
    if (!input.value) input.value = new URL("./", location.href).href;
    desenharQR();
    input.addEventListener("input", desenharQR);
  }

  function desenharQR() {
    const canvas = $("#qr");
    const ctx = canvas.getContext("2d");
    const url = $("#qr-url").value.trim();
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!url || !window.qrcode) return;
    const qr = window.qrcode(0, "M");
    qr.addData(url); qr.make();
    const n = qr.getModuleCount(), margem = 4;
    const cel = Math.floor(canvas.width / (n + margem * 2));
    const off = Math.floor((canvas.width - cel * n) / 2);
    ctx.fillStyle = "#1F2614";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) ctx.fillRect(off + c * cel, off + r * cel, cel, cel);
  }

  $("#qr-baixar").addEventListener("click", () => {
    // versão maior para impressão
    const url = $("#qr-url").value.trim();
    if (!url) return;
    const qr = window.qrcode(0, "M"); qr.addData(url); qr.make();
    const n = qr.getModuleCount(), cel = 24, margem = 4, lado = (n + margem * 2) * cel;
    const cv = document.createElement("canvas"); cv.width = cv.height = lado;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, lado, lado);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) ctx.fillRect((c + margem) * cel, (r + margem) * cel, cel, cel);
    cv.toBlob((b) => baixar(b, "qrcode-avaliacao.png"), "image/png");
  });

  iniciar();
})();

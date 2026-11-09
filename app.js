(() => {
  "use strict";

  const CRITERIOS = [
    ["sabor", "Sabor"],
    ["qualidade", "Qualidade"]
  ];
  const ROTULOS = ["", "Muito ruim", "Ruim", "Regular", "Boa", "Excelente"];
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.83 5.73 6.33.92-4.58 4.46 1.08 6.3L12 17.24l-5.66 2.97 1.08-6.3-4.58-4.46 6.33-.92z"/></svg>';

  const cfg = window.APP_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const form = $("#form");
  const starsBox = $("#stars");
  const starLabel = $("#star-label");
  const critBox = $("#criteria");
  const obs = $("#obs");
  const count = $("#count");
  const errorBox = $("#error");
  const btn = $("#submit");

  /* ---------- Estrelas da avaliação geral ---------- */
  for (let i = 1; i <= 5; i++) {
    starsBox.insertAdjacentHTML("beforeend",
      `<input type="radio" class="sr" name="geral" id="g${i}" value="${i}">` +
      `<label for="g${i}" class="star" data-v="${i}">${STAR}` +
      `<span class="sr">${i} ${i === 1 ? "estrela" : "estrelas"}, ${ROTULOS[i]}</span></label>`);
  }
  const starLabels = [...starsBox.querySelectorAll(".star")];
  let notaGeral = 0;

  const pintar = (v) => starLabels.forEach((l) => l.classList.toggle("on", +l.dataset.v <= v));

  starsBox.addEventListener("change", (e) => {
    notaGeral = +e.target.value;
    pintar(notaGeral);
    starLabel.textContent = ROTULOS[notaGeral];
    starLabel.classList.add("chosen");
    $("#overall").classList.remove("missing");
    if (!form.querySelector(".missing")) limparErro();
    const sel = starLabels[notaGeral - 1];
    sel.classList.remove("pop"); void sel.offsetWidth; sel.classList.add("pop");
  });
  if (window.matchMedia("(hover: hover)").matches) {
    starLabels.forEach((l) => l.addEventListener("mouseenter", () => pintar(+l.dataset.v)));
    starsBox.addEventListener("mouseleave", () => pintar(notaGeral));
  }

  /* ---------- Critérios individuais ---------- */
  CRITERIOS.forEach(([key, nome]) => {
    let html = `<div class="crit" id="row-${key}" role="radiogroup" aria-labelledby="l-${key}">` +
      `<span class="crit-name" id="l-${key}">${nome}</span><div class="scale">`;
    for (let i = 1; i <= 5; i++) {
      html += `<input type="radio" class="sr" name="${key}" id="${key}${i}" value="${i}">` +
        `<label for="${key}${i}" class="dot"><span aria-hidden="true">${i}</span>` +
        `<span class="sr">${i}, ${ROTULOS[i]}</span></label>`;
    }
    critBox.insertAdjacentHTML("beforeend", html + "</div></div>");
  });
  critBox.addEventListener("change", (e) => {
    const row = e.target.closest(".crit");
    if (row) row.classList.remove("missing");
    if (!form.querySelector(".missing")) limparErro();
  });

  /* ---------- Observações ---------- */
  obs.addEventListener("input", () => { count.textContent = obs.value.length; });

  /* ---------- Envio ---------- */
  const valor = (name) => {
    const el = form.querySelector(`input[name="${name}"]:checked`);
    return el ? +el.value : null;
  };

  const novoId = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  const mostrarErro = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; };
  const limparErro = () => { errorBox.hidden = true; errorBox.textContent = ""; };

  let enviando = false;
  let idPendente = null; // mesmo id em novas tentativas: o banco recusa duplicatas

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (enviando) return;
    limparErro();

    const dados = { nota_geral: valor("geral") };
    CRITERIOS.forEach(([k]) => { dados[k] = valor(k); });

    const faltando = [];
    if (!dados.nota_geral) { faltando.push("avaliação geral"); $("#overall").classList.add("missing"); }
    CRITERIOS.forEach(([k, nome]) => {
      if (!dados[k]) { faltando.push(nome.toLowerCase()); $(`#row-${k}`).classList.add("missing"); }
    });
    if (faltando.length) {
      mostrarErro(`Falta avaliar: ${faltando.join(", ")}.`);
      const primeiro = form.querySelector(".missing");
      if (primeiro) primeiro.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const texto = obs.value.trim();
    dados.observacao = texto ? texto.slice(0, 1000) : null;

    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes("SEU-PROJETO")) {
      mostrarErro("O site ainda não foi configurado. Avise a equipe responsável.");
      return;
    }

    idPendente = idPendente || novoId();
    dados.id = idPendente;

    enviando = true;
    btn.disabled = true;
    btn.textContent = "Enviando…";
    form.setAttribute("aria-busy", "true");

    const headers = {
      "Content-Type": "application/json",
      apikey: cfg.supabaseAnonKey,
      Prefer: "return=minimal"
    };
    // Chaves antigas (JWT "anon") também precisam do cabeçalho Authorization.
    if (!cfg.supabaseAnonKey.startsWith("sb_")) headers.Authorization = `Bearer ${cfg.supabaseAnonKey}`;

    try {
      const r = await fetch(`${cfg.supabaseUrl.replace(/\/$/, "")}/rest/v1/avaliacoes`, {
        method: "POST",
        headers,
        body: JSON.stringify(dados),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store"
      });
      // 409 = esta mesma avaliação já tinha chegado numa tentativa anterior
      if (r.ok || r.status === 409) { concluir(); return; }
      throw new Error(`HTTP ${r.status}`);
    } catch (_) {
      mostrarErro("Não foi possível enviar agora. Verifique sua conexão e toque em “Enviar avaliação” novamente.");
    } finally {
      enviando = false;
      btn.disabled = false;
      btn.textContent = "Enviar avaliação";
      form.removeAttribute("aria-busy");
    }
  });

  function concluir() {
    idPendente = null;
    form.reset();
    notaGeral = 0; pintar(0);
    count.textContent = "0";
    $("#form-view").hidden = true;
    $("#done-view").hidden = false;
    window.scrollTo(0, 0);
    $("#done-title").focus({ preventScroll: true });
  }
})();

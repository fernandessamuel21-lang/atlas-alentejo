/* Atlas Alentejo — estado da aplicação, composição das camadas e exploração. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const mv = $("mv"),
    geo = window.AtlasGeo;
  const fmt = new Intl.NumberFormat("pt-PT"),
    decimal = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TYPES = {
    rios: "Rio",
    lagos: "Lago / albufeira",
    transicao: "Águas de transição",
    costeiras: "Águas costeiras",
    cidade: "Cidade",
    vila: "Localidade",
    foz: "Foz",
    albufeira: "Albufeira",
    cume: "Altitude máxima",
  };
  const NATURES = {
    "Natural water body": "Natural",
    "Heavily modified water body": "Fortemente modificada",
    "Artificial water body": "Artificial",
  };
  const LAYERS = [
    "base_cor.jpg",
    "mar.png",
    "albufeiras.png",
    "rios.png",
    "limites.png",
  ];
  let D,
    images,
    basemap = "relevo",
    inAR = false,
    region = "all",
    k = 1,
    pins = [],
    selected = null,
    probe = null;
  let ready = false,
    textureBusy = false,
    textureRevision = 0,
    focusReturn = null,
    down = null;
  let activeTexture = null,
    initPromise,
    labelFrame = 0,
    labelPasses = 0,
    framingFrame = 0,
    fittedRadius = 1,
    wheelGoal = null,
    wheelTime = 0;
  const panelMedia = matchMedia("(max-width: 760px)");
  function setPanel(open) {
    $("controlPanel").hidden = !open;
    $("panelToggle").setAttribute("aria-expanded", String(open));
    $("explorar").classList.toggle("panel-open", open);
    updateViewport();
    scheduleLabels();
  }
  setPanel(!panelMedia.matches);
  panelMedia.addEventListener("change", () => setPanel(!panelMedia.matches));
  $("panelToggle").addEventListener("click", () =>
    setPanel($("controlPanel").hidden),
  );
  const controls = [
    ...document.querySelectorAll(
      ".sidebar button, .sidebar input, .view-toolbar button, .zoom-tools button",
    ),
  ];

  function notify(message) {
    $("noticeText").textContent = message;
    $("notice").hidden = false;
    $("loading").hidden = true;
  }
  function setEnabled(enabled) {
    controls.forEach((c) => {
      c.disabled = !enabled;
    });
  }
  function loadImage(name) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error("Não foi possível carregar uma camada do mapa."));
      image.src = "modelo/camadas/" + name;
    });
  }
  async function loadData() {
    const response = await fetch("modelo/dados.json", { cache: "no-cache" });
    if (!response.ok)
      throw new Error("Não foi possível carregar os dados do atlas.");
    const data = await response.json();
    if (
      data.schema_version !== 3 ||
      !data.camadas_agua ||
      !Array.isArray(data.camadas_agua.niveis) ||
      !Array.isArray(data.massas) ||
      !Array.isArray(data.locais) ||
      !Array.isArray(data.regioes) ||
      !data.escala ||
      !data.fonte ||
      !data.bounds ||
      !data.exagero ||
      data.n_massas !== data.massas.length
    )
      throw new Error(
        "Os dados do atlas estão incompletos ou são de outra versão.",
      );
    return data;
  }
  const viewerReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "O carregamento do modelo demorou demasiado. Verifique a ligação e tente novamente.",
          ),
        ),
      90000,
    );
    mv.addEventListener(
      "load",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    mv.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("Não foi possível abrir o modelo 3D."));
      },
      { once: true },
    );
    customElements.whenDefined("model-viewer").then(() => {
      if (mv.loaded) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  mv.addEventListener("progress", (event) => {
    const progress = event.detail.totalProgress;
    $("loadProgress").value = progress;
    $("loadingText").textContent =
      progress < 1
        ? `A carregar o modelo 3D… ${Math.round(progress * 100)}%`
        : "A preparar as camadas…";
  });
  mv.addEventListener("error", () => {
    ready = false;
    setEnabled(false);
    notify(
      "Não foi possível carregar o modelo 3D. Verifique se o browser suporta WebGL e tente novamente.",
    );
  });

  async function init() {
    try {
      [D, images] = await Promise.all([
        loadData(),
        Promise.all(LAYERS.map(loadImage)),
        viewerReady,
      ]);
      images = Object.fromEntries(LAYERS.map((name, i) => [name, images[i]]));
      proj4.defs(
        "EPSG:3763",
        "+proj=tmerc +lat_0=39.6682583333333 +lon_0=-8.13310833333333 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs",
      );
      $("resolution").textContent =
        `MDS ${D.fonte.resolucao_mds_m} m · malha ${D.fonte.malha_m} m`;
      $("exaggeration").value = D.exagero;
      $("exaggerationOut").textContent = D.exagero + "×";
      $("arMethod").textContent =
        `O maior lado do modelo mede 60 cm, à escala horizontal aproximada de 1:${fmt.format(Math.round(1 / D.escala))}. O exagero vertical inicial é ${D.exagero}×. As aplicações externas de AR podem apresentar as camadas e o exagero da versão exportada, em vez das opções escolhidas no browser.`;
      for (const r of D.regioes) {
        const block = document.createElement("div");
        const title = document.createElement("span");
        title.textContent = r.codigo.replace("PT", "") + " · " + r.nome;
        const value = document.createElement("strong");
        value.textContent = decimal.format(r.area_km2) + " km²";
        block.append(title, value);
        $("aboutFacts").append(block);
      }
      addPins();
      updateStats();
      ready = true;
      if (!mv.availableAnimations.includes(D.camadas_agua.animacao))
        throw new Error(
          "O modelo não inclui as camadas de água independentes.",
        );
      for (const [group, color] of Object.entries(D.camadas_agua.cores || {})) {
        document.documentElement.style.setProperty(
          group === "rios" ? "--river-color-data" : "--lake-color-data",
          `rgb(${color.join(", ")})`,
        );
      }
      mv.animationName = D.camadas_agua.animacao;
      await mv.updateComplete;
      mv.pause();
      await applyWaterColors();
      updateWaterPose();
      await updateTexture();
      mv.interpolationDecay = reduceMotion ? 0 : 120;
      resetCamera();
      setEnabled(true);
      $("loading").hidden = true;
    } catch (error) {
      console.error(error);
      ready = false;
      setEnabled(false);
      notify(error.message || "Não foi possível preparar o atlas.");
    }
  }
  $("retry").addEventListener("click", () => location.reload());
  mv.addEventListener("ar-status", (event) => {
    const active = event.detail.status === "session-started";
    if (active === inAR) return;
    inAR = active;
    if (inAR) clearSelection();
    updatePins();
  });
  // As camadas 3D da água e os seus contornos seguem o tema; no escuro, tons
  // mais claros mantêm o contraste com o terreno esbatido e o fundo.
  async function applyWaterColors() {
    const css = getComputedStyle(document.documentElement);
    for (const [material, name] of [
      ["agua_rios", "--river-color"],
      ["agua_albufeiras", "--lake-color"],
      ["contorno_rios", "--river-edge"],
      ["contorno_albufeiras", "--lake-edge"],
    ]) {
      const color = css.getPropertyValue(name).trim();
      const target = mv.model?.getMaterialByName(material);
      if (!color || !target) continue;
      try {
        await target.ensureLoaded();
        target.pbrMetallicRoughness.setBaseColorFactor(color);
      } catch (error) {
        // Mantém as cores exportadas no modelo; não impede a exploração.
        console.warn(error);
      }
    }
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!ready) return;
    void applyWaterColors();
    scheduleTexture();
  });
  initPromise = init();

  function regionData() {
    return D.regioes.find((r) => r.codigo === region);
  }
  function filteredWater() {
    return D.massas.filter((m) => region === "all" || m.regiao === region);
  }
  function updateStats() {
    const water = filteredWater();
    $("waterCount").textContent = fmt.format(water.length);
    $("riverLength").textContent = fmt.format(
      Math.round(
        water
          .filter((m) => m.tipo === "rios")
          .reduce((a, m) => a + m.comprimento_km, 0),
      ),
    );
    $("mapTitle").textContent = regionData()?.nome || "Sado, Mira e Guadiana";
  }
  function modelToGeo(x, z) {
    const [lon, lat] = proj4("EPSG:3763", "EPSG:4326", [
      x / D.escala + D.cx,
      D.cy - z / D.escala,
    ]);
    return `${decimalCoordinate(lat)}° N · ${decimalCoordinate(Math.abs(lon))}° W`;
  }
  function decimalCoordinate(n) {
    return n.toFixed(4).replace(".", ",");
  }
  function findRegion(x, z) {
    return D.regioes.find((r) =>
      r.poligonos.some((p) => geo.inPolygon(x, z, p)),
    );
  }
  function clearProbe() {
    probe?.remove();
    probe = null;
  }
  function clearSelection() {
    const hadWater = selected?.kind === "water";
    selected = null;
    clearProbe();
    pins.forEach((p) => p.setAttribute("aria-pressed", "false"));
    scheduleLabels();
    $("infoCard").hidden = true;
    if (hadWater) scheduleTexture();
  }
  function showInfo(kind, title, description, details, note = "") {
    $("infoKind").textContent = kind;
    $("infoTitle").textContent = title;
    $("infoDescription").textContent = description;
    $("infoNote").textContent = note;
    $("infoDetails").replaceChildren();
    for (const [key, value] of details) {
      if (value == null) continue;
      const dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = key;
      dd.textContent = value;
      $("infoDetails").append(dt, dd);
    }
    $("infoCard").hidden = false;
  }
  $("cardClose").addEventListener("click", () => {
    clearSelection();
    if (focusReturn === search) setPanel(true);
    focusReturn?.focus({ preventScroll: true });
  });
  function addPins() {
    D.locais.forEach((l, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pin";
      button.slot = "hotspot-l" + i;
      button.dataset.position = l.pos.join(" ");
      button.dataset.normal = "0 1 0";
      button.dataset.tipo = l.tipo;
      button.setAttribute("aria-label", l.nome);
      button.title = l.nome;
      button.setAttribute("aria-pressed", "false");
      const dot = document.createElement("span"),
        label = document.createElement("span");
      dot.className = "pin-dot";
      dot.setAttribute("aria-hidden", "true");
      label.className = "pin-label";
      label.textContent = l.nome;
      button.append(dot, label);
      for (const event of ["pointerenter", "pointerleave", "focus", "blur"])
        button.addEventListener(event, scheduleLabels);
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        if (inAR) {
          // Em AR a ficha não é visível: tocar no pino mostra ou esconde o nome.
          const label = button.querySelector(".pin-label");
          label.hidden = !label.hidden;
          scheduleLabels();
          return;
        }
        focusReturn = button;
        selectPlace(i);
      });
      mv.append(button);
      pins.push(button);
    });
    updatePins();
  }
  function updatePins() {
    if (!D) return;
    if (inAR) {
      // Em AR (WebXR) ficam só os pinos das albufeiras, com os nomes escondidos
      // até se tocar em cada pino, como no modelo USDZ do iPhone.
      pins.forEach((pin, i) => {
        pin.hidden = D.locais[i].tipo !== "albufeira";
        pin.querySelector(".pin-label").hidden = true;
      });
      scheduleLabels();
      return;
    }
    pins.forEach((pin, i) => {
      const local = D.locais[i];
      const reservoir = local.tipo === "albufeira";
      const show = $(reservoir ? "showReservoirPins" : "showPlaces").checked;
      const labels = $(reservoir ? "showReservoirLabels" : "showPlaceLabels").checked;
      pin.hidden = !show || (region !== "all" && local.regiao !== region);
      pin.querySelector(".pin-label").hidden = !labels;
      if (pin.hidden && selected?.kind === "place" && selected.index === i)
        clearSelection();
    });
    scheduleLabels();
  }
  function scheduleLabels() {
    // model-viewer updates hotspot projections after camera events; allow the
    // following render frames to settle before the final collision pass.
    labelPasses = 3;
    if (labelFrame) return;
    labelFrame = requestAnimationFrame(layoutLabels);
  }
  function layoutLabels() {
    labelFrame = 0;
    if (!ready) return;
    const bounds = mv.getBoundingClientRect();
    const intersects = (a, b, gap = 5) =>
      a.left < b.right + gap && a.right + gap > b.left &&
      a.top < b.bottom + gap && a.bottom + gap > b.top;
    const occupied = ["controlPanel", "infoCard"].map($)
      .filter((el) => !el.hidden).map((el) => el.getBoundingClientRect());
    const entries = pins.filter((pin) => !pin.hidden).map((pin) => {
      const label = pin.querySelector(".pin-label");
      if (label.hidden) return null;
      return { pin, label, anchor: pin.getBoundingClientRect(),
        size: label.getBoundingClientRect(),
        priority: pin.getAttribute("aria-pressed") === "true" ? 2
          : pin.matches(":hover, :focus-visible") ? 1 : 0 };
    }).filter(Boolean).sort((a, b) => b.priority - a.priority);
    for (const { label, anchor, size } of entries) {
      const x = anchor.left + anchor.width / 2;
      const y = anchor.top + anchor.height / 2;
      const gap = anchor.width / 2 + 5;
      const candidates = [
        [x + gap, y - size.height / 2],
        [x - gap - size.width, y - size.height / 2],
        [x - size.width / 2, y - gap - size.height],
        [x - size.width / 2, y + gap],
      ];
      const position = candidates.map(([left, top]) => ({
        left, top, right: left + size.width, bottom: top + size.height,
      })).find((rect) => rect.left >= bounds.left + 8 && rect.right <= bounds.right - 8 &&
        rect.top >= bounds.top + 8 && rect.bottom <= bounds.bottom - 8 &&
        !occupied.some((other) => intersects(rect, other)));
      label.style.visibility = position ? "" : "hidden";
      if (position) {
        label.style.left = `${position.left - anchor.left}px`;
        label.style.top = `${position.top + size.height / 2 - anchor.top}px`;
        occupied.push(position);
      }
    }
    if (--labelPasses > 0) labelFrame = requestAnimationFrame(layoutLabels);
  }
  function selectPlace(i) {
    clearSelection();
    const l = D.locais[i];
    selected = { kind: "place", index: i };
    pins[i].setAttribute("aria-pressed", "true");
    scheduleLabels();
    showInfo(
      TYPES[l.tipo],
      l.nome,
      l.nota,
      [
        ["Altitude MDS", l.cota == null ? null : `${fmt.format(l.cota)} m`],
        ["Região", findRegion(l.pos[0], l.pos[2])?.nome],
        ["Coordenadas", modelToGeo(l.pos[0], l.pos[2])],
      ],
      "Altitude amostrada no MDS a 30 m.",
    );
    const pos = localPosition(l);
    mv.cameraTarget = `${pos[0]}m ${pos[1] * k}m ${pos[2]}m`;
  }
  function placeProbe(pos, surface = null) {
    clearProbe();
    probe = document.createElement("div");
    probe.className = "probe";
    probe.slot = "hotspot-probe";
    if (surface) probe.dataset.surface = surface;
    else probe.dataset.position = `${pos[0]} ${pos[1] * k} ${pos[2]}`;
    mv.append(probe);
  }
  function selectWater(m, focus = true, hit = null, surface = null) {
    clearSelection();
    selected = { kind: "water", water: m };
    showInfo(
      TYPES[m.tipo],
      m.nome,
      "Massa de água identificada no reporte EEA WISE de 2022.",
      [
        ["Código", m.codigo],
        [
          "Região",
          m.regiao.replace("PT", "") +
            " · " +
            (D.regioes.find((r) => r.codigo === m.regiao)?.nome || ""),
        ],
        ["Natureza", NATURES[m.natureza] || m.natureza],
        [
          "Comprimento",
          m.comprimento_km == null
            ? null
            : decimal.format(m.comprimento_km) + " km",
        ],
        [
          "Área",
          m.area_km2 == null ? null : decimal.format(m.area_km2) + " km²",
        ],
        ["Coordenadas", modelToGeo(...m.centro)],
      ],
      m.pos
        ? "Geometria simplificada para exploração no atlas."
        : "Esta massa de água estende-se para fora da superfície 3D disponível.",
    );
    if (hit) placeProbe(hit, surface);
    else if (m.pos) placeProbe(waterPosition(m));
    if (focus && m.pos) {
      const pos = waterPosition(m);
      mv.cameraTarget = `${pos[0]}m ${pos[1] * k}m ${pos[2]}m`;
    }
    scheduleTexture();
  }

  const search = $("search");
  function searchResults() {
    const query = geo.normalize(search.value.trim());
    $("results").replaceChildren();
    if (!query) {
      $("results").hidden = true;
      $("searchCount").textContent = "";
      return;
    }
    const items = [
      ...D.locais.map((l, i) => ({
        name: l.nome,
        type: TYPES[l.tipo],
        region: l.regiao,
        action: () => selectPlace(i),
      })),
      ...filteredWater().map((m) => ({
        name: m.nome,
        code: m.codigo,
        type: TYPES[m.tipo],
        region: m.regiao,
        action: () => selectWater(m),
      })),
    ].filter(
      (l) =>
        (region === "all" || l.region === region) &&
        geo.normalize(l.name + " " + (l.code || "")).includes(query),
    );
    $("searchCount").textContent = `${items.length} resultados`;
    $("results").hidden = false;
    if (!items.length) {
      const p = document.createElement("p");
      p.textContent = "Sem resultados nesta região.";
      $("results").append(p);
    }
    for (const item of items.slice(0, 40)) {
      const b = document.createElement("button"),
        label = document.createElement("span"),
        small = document.createElement("small");
      b.type = "button";
      label.textContent = item.name;
      small.textContent =
        item.type + " · " + (item.region || "").replace("PT", "");
      b.append(label, small);
      b.addEventListener("click", () => {
        focusReturn = search;
        item.action();
        $("results").hidden = true;
        search.value = "";
        if (panelMedia.matches) setPanel(false);
        $("cardClose").focus({ preventScroll: true });
      });
      $("results").append(b);
    }
    if (items.length > 40) {
      const p = document.createElement("p");
      p.textContent = "Primeiros 40 resultados. Escreva mais para refinar.";
      $("results").append(p);
    }
  }
  search.addEventListener("input", searchResults);
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      $("results").querySelector("button")?.focus();
    }
  });
  $("results").addEventListener("keydown", (e) => {
    const buttons = [...$("results").querySelectorAll("button")],
      i = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      buttons[
        Math.max(
          0,
          Math.min(buttons.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)),
        )
      ]?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) $("results").hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("results").hidden = true;
      clearSelection();
    }
    if (
      e.key === "/" &&
      !/INPUT|TEXTAREA/.test(document.activeElement.tagName) &&
      !$("aboutDialog").open &&
      ready
    ) {
      e.preventDefault();
      setPanel(true);
      search.focus();
    }
  });

  function pathPolygons(polygons, ctx, width, height) {
    const [left, bottom, right, top] = D.bounds;
    const xy = ([x, z]) => [
      ((x / D.escala + D.cx - left) / (right - left)) * width,
      ((top - D.cy + z / D.escala) / (top - bottom)) * height,
    ];
    const path = new Path2D();
    for (const poly of polygons)
      for (const ring of poly) {
        ring.forEach((p, i) => {
          const [x, y] = xy(p);
          if (i === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        });
        path.closePath();
      }
    return path;
  }
  function buildCanvas() {
    // As cores pintadas na textura seguem os tokens do tema (claro ou escuro).
    const css = getComputedStyle(document.documentElement);
    const token = (name) => css.getPropertyValue(name).trim();
    const canvas = document.createElement("canvas");
    canvas.width = images["base_cor.jpg"].width;
    canvas.height = images["base_cor.jpg"].height;
    const ctx = canvas.getContext("2d");
    const detached = $("detachWater").checked;
    const orto = basemap === "orto" && images["base_orto.jpg"];
    ctx.drawImage(orto || images["base_cor.jpg"], 0, 0);
    if (detached) {
      // Com a água elevada, o relevo recua para que as camadas sobressaiam.
      ctx.fillStyle = token("--map");
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(images["mar.png"], 0, 0);
    // Elevada, a água deixa uma pegada ténue no terreno que mostra a sua origem.
    // Sobre a ortoimagem, a pegada precisa de mais opacidade para se distinguir.
    ctx.globalAlpha = detached ? (orto ? 0.45 : 0.3) : 1;
    if ($("showLakes").checked) ctx.drawImage(images["albufeiras.png"], 0, 0);
    if ($("showRivers").checked) ctx.drawImage(images["rios.png"], 0, 0);
    ctx.globalAlpha = 1;
    if ($("showBounds").checked) ctx.drawImage(images["limites.png"], 0, 0);
    if (region !== "all") {
      const source = document.createElement("canvas");
      source.width = canvas.width;
      source.height = canvas.height;
      source.getContext("2d").drawImage(canvas, 0, 0);
      ctx.fillStyle = token("--map");
      ctx.globalAlpha = 0.7;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      const path = pathPolygons(
        regionData().poligonos,
        ctx,
        canvas.width,
        canvas.height,
      );
      ctx.save();
      ctx.clip(path, "evenodd");
      ctx.drawImage(source, 0, 0);
      ctx.restore();
      ctx.strokeStyle = token("--accent");
      ctx.lineWidth = 5;
      ctx.stroke(path);
    }
    if (
      selected?.kind === "water" &&
      liftOffset(selected.water.tipo) <= D.camadas_agua.folga
    ) {
      const g = selected.water.geometria;
      ctx.strokeStyle = token("--selection-halo");
      ctx.lineWidth = 15;
      ctx.lineJoin = "round";
      const [left, bottom, right, top] = D.bounds;
      const draw = () => {
        ctx.beginPath();
        for (const ln of geo.lines(g))
          ln.forEach(([x, z], i) => {
            const px =
                ((x / D.escala + D.cx - left) / (right - left)) * canvas.width,
              py =
                ((top - D.cy + z / D.escala) / (top - bottom)) * canvas.height;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
        ctx.stroke();
      };
      draw();
      ctx.strokeStyle = token("--accent");
      ctx.lineWidth = 7;
      draw();
    }
    return canvas;
  }
  function scheduleTexture() {
    textureRevision++;
    if (!textureBusy) void updateTexture();
  }
  async function updateTexture() {
    if (!ready) return;
    textureBusy = true;
    $("textureState").textContent = "A atualizar camadas…";
    const revision = textureRevision;
    try {
      const material = mv.model?.getMaterialByName("terreno");
      if (!material)
        throw new Error("O material do terreno não está disponível.");
      const next = await mv.createTexture(
        buildCanvas().toDataURL("image/jpeg", 0.9),
        "image/jpeg",
      );
      if (revision === textureRevision) {
        material.pbrMetallicRoughness.baseColorTexture.setTexture(next);
        activeTexture = next;
      }
    } catch (error) {
      console.error(error);
      notify(
        "Não foi possível atualizar a textura. Recarregue o atlas para recuperar as camadas.",
      );
    } finally {
      textureBusy = false;
      $("textureState").textContent = "";
      if (revision !== textureRevision) void updateTexture();
    }
  }
  // A ortoimagem só é descarregada quando é escolhida pela primeira vez.
  document.querySelectorAll("[data-base]").forEach((button) =>
    button.addEventListener("click", async () => {
      const choice = button.dataset.base;
      if (choice === basemap) return;
      if (choice === "orto" && !images["base_orto.jpg"]) {
        $("textureState").textContent = "A carregar a ortoimagem…";
        try {
          images["base_orto.jpg"] = await loadImage("base_orto.jpg");
        } catch (error) {
          console.error(error);
          $("textureState").textContent = "";
          notify("Não foi possível carregar a ortoimagem. Tente novamente.");
          return;
        }
      }
      basemap = choice;
      document.querySelectorAll("[data-base]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.base === basemap)),
      );
      $("legendRelief").hidden = basemap !== "relevo";
      $("legendOrto").hidden = basemap !== "orto";
      scheduleTexture();
    }),
  );
  for (const id of ["showRivers", "showLakes", "showBounds"])
    $(id).addEventListener("change", () => {
      clearSelection();
      updateWaterPose();
      scheduleTexture();
    });
  for (const id of ["showPlaces", "showReservoirPins", "showPlaceLabels", "showReservoirLabels"])
    $(id).addEventListener("change", updatePins);
  document.querySelectorAll("[data-region]").forEach((b) =>
    b.addEventListener("click", () => {
      region = b.dataset.region;
      clearSelection();
      document
        .querySelectorAll("[data-region]")
        .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      updatePins();
      updateStats();
      updateWaterPose();
      searchResults();
      scheduleTexture();
      resetCamera();
    }),
  );

  // O controlo define a separação visual. O exagero (k) escala também a
  // translação da água, por isso escolhe-se o nível do modelo mais próximo de
  // separação ÷ k: a água sobe o mesmo no ecrã com qualquer exagero.
  function liftLevel(type) {
    const meta = D.camadas_agua;
    const id = type === "rios" ? "riverLift" : "lakeLift";
    const wanted = (meta.separacao_max * Number($(id).value)) / 100 / k;
    let best = 0;
    meta.niveis.forEach((level, i) => {
      if (Math.abs(level - wanted) < Math.abs(meta.niveis[best] - wanted))
        best = i;
    });
    return best;
  }
  function liftOffset(type) {
    const meta = D.camadas_agua;
    return $("detachWater").checked
      ? meta.folga + meta.niveis[liftLevel(type)]
      : 0;
  }
  function waterPosition(water) {
    const pos = [...water.pos];
    if (water.tipo === "rios" || ["lagos", "transicao"].includes(water.tipo))
      pos[1] += liftOffset(water.tipo);
    return pos;
  }
  function localPosition(local) {
    const pos = [...local.pos];
    if (local.tipo === "albufeira" && $("showLakes").checked)
      pos[1] += liftOffset("lagos");
    return pos;
  }
  function updateWaterPose() {
    if (!ready) return;
    const meta = D.camadas_agua;
    const detached = $("detachWater").checked;
    const river =
      detached && $("showRivers").checked ? liftLevel("rios") : meta.oculto;
    const lake =
      detached && $("showLakes").checked ? liftLevel("lagos") : meta.oculto;
    const frame =
      meta.regioes.indexOf(region) * meta.estados ** 2 +
      lake * meta.estados +
      river;
    mv.currentTime = frame;
    $("liftControls").hidden = !detached;
    $("riverLift").disabled = !$("showRivers").checked;
    $("lakeLift").disabled = !$("showLakes").checked;
    $("riverLiftOut").textContent = (detached ? $("riverLift").value : 0) + "%";
    $("lakeLiftOut").textContent = (detached ? $("lakeLift").value : 0) + "%";
    $("mapHint").textContent = detached
      ? "Água elevada · separação visual, sem alteração das cotas"
      : matchMedia("(pointer: fine)").matches
        ? "Arraste para deslocar · Botão direito para rodar · Clique para consultar"
        : "Arraste para explorar · Toque para consultar";
    D.locais.forEach((l, i) => {
      const pos = localPosition(l);
      mv.updateHotspot({
        name: "hotspot-l" + i,
        position: `${pos[0]} ${pos[1] * k} ${pos[2]}`,
      });
    });
    scheduleLabels();
    if (selected?.kind === "water" && selected.water.pos)
      placeProbe(waterPosition(selected.water));
  }
  $("detachWater").addEventListener("change", () => {
    if ($("detachWater").checked) {
      if (!Number($("riverLift").value) && !Number($("lakeLift").value)) {
        // Rios por cima das albufeiras e estuários.
        $("riverLift").value = 75;
        $("lakeLift").value = 40;
      }
      stopRotation();
      fitCamera(panelMedia.matches ? -10 : -20, panelMedia.matches ? 35 : 58);
    }
    updateWaterPose();
    scheduleTexture();
  });
  for (const id of ["riverLift", "lakeLift"])
    $(id).addEventListener("input", () => {
      updateWaterPose();
      if (selected?.kind === "water") scheduleTexture();
    });
  $("settleWater").addEventListener("click", () => {
    $("detachWater").checked = false;
    $("riverLift").value = 0;
    $("lakeLift").value = 0;
    updateWaterPose();
    scheduleTexture();
  });
  function stopRotation() {
    mv.autoRotate = false;
    $("rotate").setAttribute("aria-pressed", "false");
  }
  function updateViewport() {
    const stage = $("stage").getBoundingClientRect();
    const panel = $("controlPanel");
    const left = !panelMedia.matches && !panel.hidden
      ? panel.getBoundingClientRect().right - stage.left + 20 : 18;
    mv.style.setProperty("--viewer-left", `${left}px`);
  }
  function fitCamera(theta, phi) {
    if (!ready) return;
    const dims = mv.getDimensions();
    const box = mv.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const t = theta * Math.PI / 180, p = phi * Math.PI / 180;
    const direction = [Math.sin(p) * Math.sin(t), Math.cos(p), Math.sin(p) * Math.cos(t)];
    const right = [Math.cos(t), 0, -Math.sin(t)];
    const up = [-Math.cos(p) * Math.sin(t), Math.sin(p), -Math.cos(p) * Math.cos(t)];
    const tanV = Math.tan(mv.getFieldOfView() * Math.PI / 360);
    const tanH = tanV * box.width / box.height;
    const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    const height = dims.y * k + ($("detachWater").checked ? D.camadas_agua.separacao_max : 0);
    const points = D.regioes.flatMap((r) => r.poligonos.flatMap((polygon) =>
      polygon[0].flatMap(([x, z]) => [[x, 0, z], [x, height, z]])));
    const target = [0, height / 2, 0];
    let radius = 0;
    // Fit the actual outline, then centre its projected extent. Empty corners
    // of the terrain bounding box should not force the map farther away.
    for (let pass = 0; pass < 4; pass++) {
      const vectors = points.map((point) => point.map((v, i) => v - target[i]));
      radius = 0;
      for (const v of vectors) {
        const depth = dot(v, direction);
        radius = Math.max(radius, depth + Math.abs(dot(v, right)) / tanH,
          depth + Math.abs(dot(v, up)) / tanV);
      }
      if (pass === 3) break;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const v of vectors) {
        const depth = radius - dot(v, direction);
        const x = dot(v, right) / depth, y = dot(v, up) / depth;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      for (let i = 0; i < 3; i++)
        target[i] += radius * ((minX + maxX) / 2 * right[i] + (minY + maxY) / 2 * up[i]);
    }
    mv.cameraTarget = target.map((v) => `${v}m`).join(" ");
    fittedRadius = radius * 1.06;
    mv.cameraOrbit = `${theta}deg ${phi}deg ${fittedRadius}m`;
    wheelGoal = null;
    scheduleLabels();
  }
  function scheduleFraming() {
    if (!ready || framingFrame) return;
    framingFrame = requestAnimationFrame(() => {
      framingFrame = 0;
      if (selected) return;
      const orbit = mv.getCameraOrbit();
      fitCamera(orbit.theta * 180 / Math.PI, orbit.phi * 180 / Math.PI);
    });
  }
  function setView(top) {
    stopRotation();
    mv.resetTurntableRotation();
    fitCamera(0, top ? 0 : 38);
    $("viewTop").setAttribute("aria-pressed", String(top));
    $("viewOblique").setAttribute("aria-pressed", String(!top));
  }
  function resetCamera() {
    mv.cameraTarget = "auto auto auto";
    setView(false);
  }
  $("viewTop").addEventListener("click", () => setView(true));
  $("viewOblique").addEventListener("click", () => setView(false));
  $("reset").addEventListener("click", () => {
    clearSelection();
    resetCamera();
  });
  $("rotate").addEventListener("click", () => {
    mv.autoRotate = !mv.autoRotate;
    $("rotate").setAttribute("aria-pressed", String(mv.autoRotate));
    if (mv.autoRotate) requestAnimationFrame(animateCompass);
  });
  function updateCompass() {
    const orbit = mv.getCameraOrbit();
    $("northArrow").style.transform =
      `rotate(${orbit.theta - mv.turntableRotation}rad)`;
  }
  function animateCompass() {
    if (!ready || !mv.autoRotate) return;
    updateCompass();
    scheduleLabels();
    requestAnimationFrame(animateCompass);
  }
  $("north").addEventListener("click", () => {
    if (!ready) return;
    stopRotation();
    mv.resetTurntableRotation();
    const o = mv.getCameraOrbit();
    mv.cameraOrbit = `0rad ${o.phi}rad ${o.radius}m`;
  });
  function zoom(factor) {
    const o = mv.getCameraOrbit();
    mv.cameraOrbit = `${o.theta}rad ${o.phi}rad ${o.radius * factor}m`;
  }
  $("zoomIn").addEventListener("click", () => zoom(0.8));
  $("zoomOut").addEventListener("click", () => zoom(1.25));
  // Câmara com rato, à maneira de um mapa: a roda aproxima em direção ao ponto sob
  // o cursor, o botão esquerdo desloca o mapa e o direito (ou Ctrl/Shift/⌘ com o
  // esquerdo) roda e inclina. O toque mantém os gestos de model-viewer.
  const ZOOM_MIN_RADIUS = 0.02; // igual ao raio de min-camera-orbit no HTML
  function cameraState() {
    const t = mv.getCameraTarget();
    return { target: [t.x, t.y, t.z], orbit: mv.getCameraOrbit() };
  }
  function setCamera(target, theta, phi, radius) {
    mv.cameraTarget = target.map((v) => `${v}m`).join(" ");
    mv.cameraOrbit = `${theta}rad ${phi}rad ${radius}m`;
  }
  function clampTarget(target) {
    // O alvo não sai da área do modelo, para a vista não se perder no vazio.
    const dims = mv.getDimensions();
    const half = Math.max(dims.x, dims.z) / 2;
    return target.map((v, i) => (i === 1 ? v : Math.max(-half, Math.min(half, v))));
  }
  // Ponto onde o raio da câmara que passa pelo pixel corta o plano horizontal y.
  function rayToPlane(state, clientX, clientY, y) {
    const box = mv.getBoundingClientRect();
    const { theta: t, phi: p, radius } = state.orbit;
    const back = [Math.sin(p) * Math.sin(t), Math.cos(p), Math.sin(p) * Math.cos(t)];
    const right = [Math.cos(t), 0, -Math.sin(t)];
    const up = [-Math.cos(p) * Math.sin(t), Math.sin(p), -Math.cos(p) * Math.cos(t)];
    const tanV = Math.tan((mv.getFieldOfView() * Math.PI) / 360);
    const tanH = (tanV * box.width) / box.height;
    const nx = ((clientX - box.left) / box.width) * 2 - 1;
    const ny = 1 - ((clientY - box.top) / box.height) * 2;
    const eye = state.target.map((v, i) => v + back[i] * radius);
    const ray = back.map((v, i) => -v + nx * tanH * right[i] + ny * tanV * up[i]);
    if (ray[1] > -1e-4) return null; // raio paralelo ao plano ou acima do horizonte
    const along = (y - eye[1]) / ray[1];
    return eye.map((v, i) => v + ray[i] * along);
  }
  mv.addEventListener(
    "wheel",
    (event) => {
      if (!ready) return;
      event.preventDefault();
      event.stopPropagation();
      const pixels =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      const factor = Math.exp(Math.max(-300, Math.min(300, pixels)) * 0.0015);
      // Eventos seguidos partem do destino anterior, não da posição interpolada.
      const base =
        wheelGoal && performance.now() - wheelTime < 300 ? wheelGoal : cameraState();
      const { theta, phi, radius } = base.orbit;
      const maxRadius = Math.max(fittedRadius * 2, ZOOM_MIN_RADIUS);
      const nextRadius = Math.min(maxRadius, Math.max(ZOOM_MIN_RADIUS, radius * factor));
      const scale = nextRadius / radius;
      const hit = mv.positionAndNormalFromPoint(event.clientX, event.clientY);
      const anchor = hit ? [hit.position.x, hit.position.y, hit.position.z] : base.target;
      const target = clampTarget(
        base.target.map((v, i) => anchor[i] + (v - anchor[i]) * scale),
      );
      stopRotation();
      setCamera(target, theta, phi, nextRadius);
      wheelGoal = { target, orbit: { theta, phi, radius: nextRadius } };
      wheelTime = performance.now();
    },
    { capture: true, passive: false },
  );
  let drag = null;
  mv.addEventListener(
    "pointerdown",
    (event) => {
      if (!ready || event.pointerType !== "mouse") return;
      if (event.target.closest(".pin,.ar-button")) return;
      const rotate =
        event.button === 2 || event.ctrlKey || event.metaKey || event.shiftKey;
      if (event.button !== 0 && event.button !== 2) return;
      // Impede o gesto próprio de model-viewer; o clique de consulta continua.
      event.stopPropagation();
      down = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
      stopRotation();
      mv.jumpCameraToGoal();
      wheelGoal = null;
      const state = cameraState();
      const hit = mv.positionAndNormalFromPoint(event.clientX, event.clientY);
      drag = {
        id: event.pointerId,
        rotate,
        x: event.clientX,
        y: event.clientY,
        plane: hit ? hit.position.y : state.target[1],
      };
      mv.setPointerCapture(event.pointerId);
      mv.style.cursor = rotate ? "move" : "grabbing";
    },
    { capture: true },
  );
  mv.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      event.stopPropagation();
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6)
        down.moved = true;
      const state = cameraState();
      const { theta, phi, radius } = state.orbit;
      if (drag.rotate) {
        const box = mv.getBoundingClientRect();
        const nextPhi = Math.max(0, Math.min((88 * Math.PI) / 180,
          phi - ((event.clientY - drag.y) / box.height) * Math.PI));
        setCamera(state.target,
          theta - ((event.clientX - drag.x) / box.width) * 2 * Math.PI, nextPhi, radius);
      } else {
        const from = rayToPlane(state, drag.x, drag.y, drag.plane);
        const to = rayToPlane(state, event.clientX, event.clientY, drag.plane);
        if (from && to)
          setCamera(clampTarget(state.target.map((v, i) => v + from[i] - to[i])),
            theta, phi, radius);
      }
      mv.jumpCameraToGoal();
      drag.x = event.clientX;
      drag.y = event.clientY;
    },
    { capture: true },
  );
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.stopPropagation();
    drag = null;
    mv.style.cursor = "";
    scheduleLabels();
  }
  mv.addEventListener("pointerup", endDrag, { capture: true });
  mv.addEventListener("pointercancel", endDrag, { capture: true });
  mv.addEventListener("contextmenu", (event) => event.preventDefault());
  mv.addEventListener("camera-change", () => {
    if (!ready) return;
    scheduleLabels();
    const o = mv.getCameraOrbit();
    updateCompass();
    const perspectiveAngle = 38 * Math.PI / 180;
    $("viewTop").setAttribute("aria-pressed", String(Math.abs(o.phi) < 0.02));
    $("viewOblique").setAttribute(
      "aria-pressed",
      String(Math.abs(o.phi - perspectiveAngle) < 0.02),
    );
  });
  new ResizeObserver(() => { updateViewport(); scheduleLabels(); }).observe($("stage"));
  new ResizeObserver(scheduleFraming).observe(mv);
  document.fonts.ready.then(scheduleLabels);
  $("exaggeration").addEventListener("input", () => {
    const value = Number($("exaggeration").value);
    k = value / D.exagero;
    $("exaggerationOut").textContent = value + "×";
    mv.scale = `1 ${k} 1`;
    updateWaterPose();
    if (selected?.kind === "place") {
      const l = D.locais[selected.index];
      const pos = localPosition(l);
      mv.cameraTarget = `${pos[0]}m ${pos[1] * k}m ${pos[2]}m`;
    }
  });
  mv.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  });
  mv.addEventListener("pointermove", (e) => {
    if (
      down &&
      (e.pointerId !== down.id ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6)
    )
      down.moved = true;
  });
  mv.addEventListener("pointercancel", () => {
    down = null;
  });
  mv.addEventListener("click", (e) => {
    if (!ready || !down || down.moved || e.target.closest(".pin,.ar-button"))
      return;
    down = null;
    // A API de model-viewer recebe coordenadas da janela, não do elemento.
    const sx = e.clientX,
      sy = e.clientY;
    const hit = mv.positionAndNormalFromPoint(sx, sy);
    if (!hit || hit.normal.y < 0.3) return;
    const { x, y, z } = hit.position,
      r = findRegion(x, z);
    if (!r || (region !== "all" && r.codigo !== region)) return;
    const surface = mv.surfaceFromPoint(sx, sy);
    const hitMaterial = mv.materialFromPoint(sx, sy)?.name || "";
    const hitGroup =
      hitMaterial === "agua_rios"
        ? "rios"
        : hitMaterial === "agua_albufeiras"
          ? "albufeiras"
          : null;
    let nearest = null,
      best = 700 * D.escala;
    for (const m of filteredWater()) {
      const group =
        m.tipo === "rios"
          ? "rios"
          : ["lagos", "transicao"].includes(m.tipo)
            ? "albufeiras"
            : null;
      if (hitGroup && group !== hitGroup) continue;
      if (
        !hitGroup &&
        group &&
        $("detachWater").checked &&
        liftOffset(m.tipo) > D.camadas_agua.folga
      )
        continue;
      if (m.tipo === "rios" && !$("showRivers").checked) continue;
      if (["lagos", "transicao"].includes(m.tipo) && !$("showLakes").checked)
        continue;
      const distance = geo.distance(x, z, m.geometria);
      if (distance < best) {
        nearest = m;
        best = distance;
      }
    }
    if (nearest) {
      selectWater(nearest, false, [x, y / k, z], surface);
      return;
    }
    clearSelection();
    selected = { kind: "terrain" };
    placeProbe([x, y / k, z], surface);
    const offset = hitGroup
      ? liftOffset(hitGroup === "rios" ? "rios" : "lagos")
      : 0;
    const altitude =
      (y / k - offset - D.espessura) / (D.exagero * D.escala) + D.zmin;
    showInfo(
      "PONTO NO TERRENO",
      fmt.format(Math.round(altitude)) + " m",
      "Altitude aproximada da superfície 3D.",
      [
        ["Região", r.nome],
        ["Coordenadas", modelToGeo(x, z)],
      ],
      `Interpolada na malha de ${D.fonte.malha_m} m. MDS: inclui vegetação e edifícios.`,
    );
  });
  $("aboutOpen").addEventListener("click", () => {
    $("aboutDialog").showModal();
  });
  $("aboutClose").addEventListener("click", () => {
    $("aboutDialog").close();
  });
  $("aboutDialog").addEventListener("click", (e) => {
    if (e.target === $("aboutDialog")) {
      const r = $("aboutDialog").getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        $("aboutDialog").close();
    }
  });
})();

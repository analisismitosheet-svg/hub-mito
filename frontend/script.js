/* ============================================================================
   DISEÑADOR DE ETIQUETAS — Lógica del frontend
   ----------------------------------------------------------------------------
   - Renderiza etiquetas a canvas (JsBarcode / QRCode.js) con el diseño config.
   - Vista previa escalada con reglas de medición.
   - Drag & drop de archivos (XLSX / TXT), enriquecimiento vía backend (se mantiene).
   - Autosave del diseño en localStorage.
   - Exportación a PDF (jsPDF) con modal de confirmación.
   ============================================================================ */

/* ============================================================================
   CONFIGURACIÓN
   ============================================================================ */
const URL_API = 'http://localhost:3000';        // Backend (se mantiene)
const STORAGE_KEY = 'disenador-etiquetas:v1';   // Clave para localStorage
const DPI = 150;                                 // Resolución de render de la etiqueta
const MM_POR_PX = 25.4;                          // mm por pulgada

// Formateador de precio (Cambiable)
const formateadorMoneda = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/* ============================================================================
   ESTADO DE LA APP
   ============================================================================ */
let filas = [];          // Registros enriquecidos { barcode, description, price, colorDescription, size, encontrado }
let configDisenio = null; // Diseño de la etiqueta (persistido)
let indicePreview = -1;   // Índice del registro usado para la vista previa
let redes = true;         // Si el backend está disponible

/* ============================================================================
   REFERENCIAS DOM
   ============================================================================ */
const $ = (id) => document.getElementById(id);
const $tablaCuerpo = $('tabla-cuerpo');
const $etiqueta = $('etiqueta-preview');
const $previewInfo = $('preview-info');
const $previewRecord = $('preview-record');

/* ============================================================================
   DISEÑO POR DEFECTO
   ============================================================================ */
function disenioPorDefecto() {
  return {
    ancho_mm: 70,
    alto_mm: 40,
    tipo: 'code128',       // code128 | code39 | qr
    contenido: 'codigo',   // codigo | articulo | artcolor | completo
    texto_bajo: 'codigo',  // codigo | articulo | ninguno
    altura_bc_mm: 16,
    fuentes: 11,           // tamaño de fuente px
    acento: '#2563eb',
    campos: {
      articulo: true,
      descripcion: true,
      color: true,
      talla: true,
      precio: true,
    },
    pagina_mm: [210, 297], // A4
    margen_mm: 10,
    hueco_mm: 4,
  };
}

/* ============================================================================
   PERSISTENCIA (localStorage)
   ============================================================================ */
function cargarDisenio() {
  try {
    const guardado = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (guardado && typeof guardado === 'object') {
      // Combinar con defecto para no romper si faltan claves
      const base = disenioPorDefecto();
      for (const k of Object.keys(base)) {
        if (k === 'campos') {
          for (const c of Object.keys(base.campos)) {
            if (guardado.campos && typeof guardado.campos[c] === 'boolean') {
              base.campos[c] = guardado.campos[c];
            }
          }
        } else if (guardado[k] !== undefined) {
          base[k] = guardado[k];
        }
      }
      return base;
    }
  } catch (e) { /* ignorar localStorage corrupto */ }
  return disenioPorDefecto();
}

function guardarDisenio() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configDisenio));
  } catch (e) { /* sin almacenamiento */ }
}

/* ============================================================================
   INICIALIZACIÓN DEL FORMULARIO DE DISEÑO
   ============================================================================ */
function aplicarConfigAlForm() {
  const c = configDisenio;
  $('cfg-ancho').value = c.ancho_mm;
  $('cfg-alto').value = c.alto_mm;
  $('cfg-contenido').value = c.contenido;
  $('cfg-texto-bajo').value = c.texto_bajo;
  $('cfg-altura-bc').value = c.altura_bc_mm;
  $('cfg-altura-bc-valor').textContent = c.altura_bc_mm + ' mm';
  $('cfg-fuente').value = c.fuentes;
  $('cfg-fuente-valor').textContent = c.fuentes + ' px';
  $('cfg-acento').value = c.acento;

  // tipo segmentado
  document.querySelectorAll('#cfg-tipo .segmented__btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === c.tipo);
  });

  // campos visibles
  document.querySelectorAll('[data-campo]').forEach(cb => {
    cb.checked = !!c.campos[cb.dataset.campo];
  });
}

function leerConfigDelForm() {
  const c = configDisenio;
  c.ancho_mm = clamp(parseFloat($('cfg-ancho').value) || 70, 20, 300);
  c.alto_mm = clamp(parseFloat($('cfg-alto').value) || 40, 15, 200);
  c.tipo = document.querySelector('#cfg-tipo .segmented__btn.active')?.dataset.value || 'code128';
  c.contenido = $('cfg-contenido').value;
  c.texto_bajo = $('cfg-texto-bajo').value;
  c.altura_bc_mm = clamp(parseFloat($('cfg-altura-bc').value) || 16, 8, 30);
  c.fuentes = clamp(parseInt($('cfg-fuente').value, 10) || 11, 7, 18);
  c.acento = $('cfg-acento').value;

  document.querySelectorAll('[data-campo]').forEach(cb => {
    c.campos[cb.dataset.campo] = cb.checked;
  });
  return c;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/* ============================================================================
   RENDER DE LA ETIQUETA A CANVAS
   ----------------------------------------------------------------------------
   Devuelve un canvas de tamaño real (mm → px a `DPI`). Dibuja textos y el
   código de barras (Code 128/39 con JsBarcode, QR con QRCode.js en modo canvas).
   ============================================================================ */
async function renderLabelCanvas(record) {
  const c = configDisenio;
  const W = Math.round(c.ancho_mm * DPI / MM_POR_PX);
  const H = Math.round(c.alto_mm * DPI / MM_POR_PX);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const margen = Math.round(6 * DPI / MM_POR_PX);
  let y = Math.round(8 * DPI / MM_POR_PX);
  const lineHeight = (px) => Math.round(px * 1.28);

  if (typeof JsBarcode === 'undefined' && ((typeof QRCode === 'undefined'))) {
    ctx.fillStyle = '#c00';
    ctx.fillText('Faltan librerías CDN', 10, 20);
  }

  // --- textos ---
  const arr = (mm) => Math.round(mm * DPI / MM_POR_PX);

  if (c.campos.articulo && record.articulo) {
    ctx.fillStyle = c.acento;
    ctx.font = `700 ${arr(c.fuentes + 2)}px Inter, sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Artículo: ${record.articulo}`, margen, y);
    y += lineHeight(arr(c.fuentes + 2));
  }

  const txtStyle = (px) => `500 ${arr(px)}px Inter, sans-serif`;
  if (c.campos.descripcion && record.descripcion) {
    ctx.fillStyle = '#1a202c';
    ctx.font = txtStyle(c.fuentes);
    // ajustar texto largo
    ctx.fillText(recortar(ctx, record.descripcion, W - 2 * margen), margen, y);
    y += lineHeight(arr(c.fuentes));
  }

  if (c.campos.color && (record.color || record.colorDescription)) {
    ctx.fillStyle = '#1a202c';
    ctx.font = txtStyle(c.fuentes);
    const col = record.colorDescription || '';
    ctx.fillText(`Color: ${record.color || ''} ${col}`.trim(), margen, y);
    y += lineHeight(arr(c.fuentes));
  }

  if (c.campos.talla && record.talla) {
    ctx.fillStyle = '#1a202c';
    ctx.font = txtStyle(c.fuentes);
    ctx.fillText(`Talla: ${record.talla}`, margen, y);
    y += lineHeight(arr(c.fuentes));
  }

  if (c.campos.precio && record.precio != null && record.precio !== '') {
    ctx.fillStyle = c.acento;
    ctx.font = `700 ${arr(c.fuentes + 3)}px Inter, sans-serif`;
    ctx.fillText(`Precio: ${formatearPrecio(record.precio)}`, margen, y);
    y += lineHeight(arr(c.fuentes + 3));
  }

  // --- código de barras ---
  const valor = valorBarcode(record);
  const bcAltoPx = Math.round(c.altura_bc_mm * DPI / MM_POR_PX);
  const espacioRestante = H - y - arr(8);
  const bcAlto = Math.max(arr(10), Math.min(bcAltoPx, espacioRestante));

  if (valor) {
    if (c.tipo === 'qr') {
      // QR mediante QRCode.js en modalidad canvas (cuadrado)
      const lado = Math.max(arr(20), Math.min(W - 2 * margen, bcAlto > arr(20) ? bcAlto : (W - 2 * margen)));
      const qc = document.createElement('canvas');
      try {
        await renderQR(qc, valor, lado);
      } catch (err) {
        ctx.fillStyle = '#c00';
        ctx.fillText('Error QR: ' + err.message, margen, y + 12);
        return canvas;
      }
      const espacioTexto = c.texto_bajo !== 'ninguno' ? arr(12) : 0;
      const qx = Math.floor((W - lado) / 2);
      const qy = Math.min(H - lado - arr(6) - espacioTexto, Math.max(y + arr(4), y));
      ctx.drawImage(qc, qx, qy, lado, lado);
      if (c.texto_bajo !== 'ninguno') dibujarTextoBajo(ctx, record, c, W, H);
      return canvas;
    }

    // Code 39 / 128 con JsBarcode sobre canvas temporal
    const tmp = document.createElement('canvas');
    const tmpCtx = tmp.getContext('2d');
    try {
      JsBarcode(tmp, valor, {
        format: c.tipo,
        width: 2,
        height: bcAlto,
        displayValue: true,
        fontSize: arr(9),
        font: 'Inter',
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch (err) {
      ctx.fillStyle = '#c00';
      ctx.fillText('Error barcode: ' + err.message, margen, y + 10);
      return canvas;
    }
    // centrar horizontalmente y colocar bajo los textos
    const bx = Math.floor((W - tmp.width) / 2);
    const by = Math.min(H - tmp.height - arr(6), Math.max(y + arr(4), y));
    ctx.drawImage(tmp, Math.max(bx, margen), by);
  } else if (c.texto_bajo === 'codigo' && record.barcode) {
    dibujarTextoBajo(ctx, record, c, W, H);
  }

  return canvas;
}

/* Dibuja el texto que va debajo del código de barras (si no lo pone JsBarcode) */
function dibujarTextoBajo(ctx, record, c, W, H) {
  let texto = '';
  if (c.texto_bajo === 'codigo') texto = (record.barcode || record.codigo || '');
  else if (c.texto_bajo === 'articulo') texto = (record.articulo || '');

  if (!texto) return;
  const arr = (mm) => Math.round(mm * DPI / MM_POR_PX);
  ctx.fillStyle = '#1a202c';
  ctx.font = `600 ${arr(9)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(texto, W / 2, H - arr(3));
  ctx.textAlign = 'left';
}

/* Devuelve el texto que debe codificarse según la config */
function valorBarcode(record) {
  const c = configDisenio;
  const art = record.articulo || '';
  const col = record.color || '';
  const tal = record.talla || '';
  const codigo = record.codigo || record.barcode || (art + '!' + col + '!' + tal);
  switch (c.contenido) {
    case 'articulo': return art;
    case 'artcolor': return art ? `${art}!${col}`.replace(/!+$/, '') : '';
    case 'completo': return `${art}!${col}!${tal}`;
    default: return codigo;
  }
}

/* Recorta un texto con "…" si no entra */
function recortar(ctx, texto, maxW) {
  if (ctx.measureText(texto).width <= maxW) return texto;
  let t = texto;
  let w = ctx.measureText(t + '…').width;
  while (w > maxW && t.length > 1) {
    t = t.slice(0, -1);
    w = ctx.measureText(t + '…').width;
  }
  return t + '…';
}

/* Renderiza un código QR sobre el canvas dado usando QRCode.js (modo canvas).
   Devuelve una promesa. El QRCode constructor dibuja de inmediato sobre el
   <canvas> en modo "canvas". */
function renderQR(canvas, texto, size) {
  return new Promise((resolve, reject) => {
    try {
      // Fijar el tamaño del canvas ANTES de construir el QRCode
      canvas.width = size;
      canvas.height = size;
      // En modo canvas, QRCode.js usa el <canvas> como destino.
      const qr = new QRCode(canvas, {
        text: String(texto),
        width: size,
        height: size,
        correctLevel: QRCode.CorrectLevel.M,
        colorDark: '#000000',
        colorLight: '#ffffff',
      });
      resolve(qr);
    } catch (e) {
      reject(e);
    }
  });
}

/* ============================================================================
   VISTA PREVIA ESCALADA + REGLAS
   ============================================================================ */
let secuenciaPreview = 0;

async function actualizarPreview() {
  const miToken = ++secuenciaPreview;
  if (indicePreview < 0 || indicePreview >= filas.length) {
    $etiqueta.innerHTML = '<div style="padding:40px;color:#8a94a3;text-align:center;font-size:.9rem">Seleccioná un registro para ver la etiqueta.</div>';
    $previewInfo.textContent = 'Seleccioná un registro en la tabla para previsualizar.';
    return;
  }

  const record = filas[indicePreview];
  const c = configDisenio;

  // render a canvas real
  let canvas;
  try {
    canvas = await renderLabelCanvas(record);
  } catch (e) {
    if (miToken === secuenciaPreview) $previewInfo.textContent = 'Error al renderizar: ' + e.message;
    return;
  }

  // si llegó una actualización más nueva, descartar este resultado
  if (miToken !== secuenciaPreview) return;

  // escalar a px de pantalla (1 mm ≈ escala px)
  const escalaPx = 2.2; // píxeles de pantalla por mm aprox
  $etiqueta.style.width = (c.ancho_mm * escalaPx) + 'px';
  $etiqueta.style.height = (c.alto_mm * escalaPx) + 'px';

  // vaciar y dibujar imagen escalada
  $etiqueta.innerHTML = '';
  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.display = 'block';
  $etiqueta.appendChild(img);

  $previewInfo.textContent =
    `Vista previa con datos de: ${record.barcode || record.articulo || 'registro'} · ` +
    `${c.ancho_mm} × ${c.alto_mm} mm · ${c.tipo.toUpperCase()}`;

  dibujarReglas(c);
}

/* Dibuja las reglas alrededor del preview según el tamaño en mm */
function dibujarReglas(c) {
  const stage = document.querySelector('.preview-stage');
  let rT = stage.querySelector('.ruler--top');
  let rL = stage.querySelector('.ruler--left');
  if (!rT) { rT = document.createElement('div'); rT.className = 'ruler ruler--top'; stage.appendChild(rT); }
  if (!rL) { rL = document.createElement('div'); rL.className = 'ruler ruler--left'; stage.appendChild(rL); }

  const escalaPx = 2.2;
  const widthPx = c.ancho_mm * escalaPx;

  // regla superior
  rT.innerHTML = '';
  rT.style.left = '34px';
  rT.style.right = '34px';
  rT.style.top = '16px';
  rT.style.height = '16px';
  const nMarcas = Math.min(Math.floor(c.ancho_mm / 5), 40);
  for (let i = 0; i <= c.ancho_mm / 5; i++) {
    const mm = i * 5;
    const x = (mm / c.ancho_mm) * 100 + '%';
    if (mm > c.ancho_mm) break;
    const marca = document.createElement('span');
    marca.style.cssText = `position:absolute;left:${x};bottom:0;width:1px;height:${mm % 10 === 0 ? 10 : 6}px;background:#b6bcc6;`;
    rT.appendChild(marca);
    if (mm % 10 === 0) {
      const lbl = document.createElement('span');
      lbl.textContent = mm;
      lbl.style.cssText = `position:absolute;left:${x};bottom:11px;transform:translateX(-50%);font:600 9px Inter,sans-serif;color:#8a94a3;`;
      rT.appendChild(lbl);
    }
  }

  // regla izquierda
  rL.innerHTML = '';
  rL.style.top = '34px';
  rL.style.bottom = '34px';
  rL.style.left = '16px';
  rL.style.width = '16px';
  const scaleY = c.alto_mm * escalaPx;
  rL.style.height = '';
  for (let i = 0; i <= c.alto_mm / 5; i++) {
    const mm = i * 5;
    const y = (mm / c.alto_mm) * 100 + '%';
    if (mm > c.alto_mm) break;
    const marca = document.createElement('span');
    marca.style.cssText = `position:absolute;top:${y};right:0;width:${mm % 10 === 0 ? 10 : 6}px;height:1px;background:#b6bcc6;`;
    rL.appendChild(marca);
    if (mm % 10 === 0) {
      const lbl = document.createElement('span');
      lbl.textContent = mm;
      lbl.style.cssText = `position:absolute;top:${y};right:12px;transform:translateY(-50%);font:600 9px Inter,sans-serif;color:#8a94a3;`;
      rL.appendChild(lbl);
    }
  }
}

/* ============================================================================
   TABLA DE REGISTROS
   ============================================================================ */
function dibujarTabla() {
  $tablaCuerpo.innerHTML = '';
  $('tabla-count').textContent = filas.length;

  filas.forEach((fila, i) => {
    const tr = document.createElement('tr');
    if (!fila.encontrado) tr.classList.add('sin-datos');
    if (i === indicePreview) tr.classList.add('seleccionado');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><strong>${escaparHTML(fila.barcode)}</strong></td>
      <td>${fila.encontrado ? escaper(fila.description) : 'Sin datos'}</td>
      <td>${fila.encontrado ? escaper(fila.colorDescription) : ''}</td>
      <td>${fila.encontrado ? escaper(fila.talla) : ''}</td>
      <td>${fila.encontrado && fila.precio !== '' ? formatearPrecio(fila.precio) : ''}</td>
    `;
    tr.addEventListener('click', () => {
      indicePreview = i;
      dibujarTabla();
      actualizarPreview();
      // sincronizar selector
      $previewRecord.value = String(i);
    });
    $tablaCuerpo.appendChild(tr);
  });
}

function actualizarResumen() {
  const total = filas.length;
  const unicos = new Set(filas.map(f => f.barcode)).size;
  const ok = filas.filter(f => f.encontrado).length;
  $('res-total').textContent = total;
  $('res-unicos').textContent = unicos;
  $('res-ok').textContent = ok;
  $('res-sin').textContent = total - ok;

  // llenar selector de preview
  $previewRecord.innerHTML = '<option value="">— seleccioná un registro —</option>';
  filas.forEach((f, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `${i + 1}. ${f.barcode}`;
    $previewRecord.appendChild(o);
  });
  if (indicePreview >= 0 && indicePreview < filas.length) {
    $previewRecord.value = String(indicePreview);
    $previewRecord.disabled = false;
  } else {
    indicePreview = filas.length > 0 ? 0 : -1;
    $previewRecord.disabled = filas.length === 0;
    if (filas.length > 0) $previewRecord.value = '0';
  }
  $('resumen').hidden = total === 0;
}

/* ============================================================================
   LECTURA DE ARCHIVO (XLSX / TXT)
   ============================================================================ */
async function leerArchivo(archivo) {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.txt')) {
    const texto = await archivo.text();
    return texto.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  }
  if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
    const buffer = await archivo.arrayBuffer();
    const libro = XLSX.read(buffer, { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filasHoja = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    const col = detectarColumnaCodigo(filasHoja[0] || {});
    if (!col) throw new Error('No se detectó una columna de código (BARCODE/CODIGO/CODE).');
    return filasHoja.map(f => String(f[col]).trim()).filter(c => c);
  }
  throw new Error('Formato no soportado. Usá .xlsx, .xls o .txt');
}

function detectarColumnaCodigo(fila) {
  const sin = ['barcode', 'codigo', 'code', 'cod', 'referencia'];
  for (const clave of Object.keys(fila)) {
    const n = clave.trim().toLowerCase();
    if (sin.some(s => n === s || n.includes(s))) return clave;
  }
  return null;
}

/* ============================================================================
   ENRIQUECIMIENTO (backend se mantiene)
   ============================================================================ */
async function enriquecerCodigos(codigos) {
  const unicos = [...new Set(codigos)];
  const resultados = new Map();
  const total = unicos.length;
  mostrarEstado(true, `Consultando base de datos… 0 / ${total}`);

  for (let i = 0; i < total; i++) {
    const codigo = unicos[i];
    try {
      const resp = await fetch(`${URL_API}/api/producto?barcode=${encodeURIComponent(codigo)}`);
      if (!resp.ok) {
        resultados.set(codigo, crearVacio());
      } else {
        const d = await resp.json();
        resultados.set(codigo, {
          description: (d.description || '').trim(),
          price: d.price ?? '',
          colorDescription: (d.colorDescription || '').trim(),
          talla: (d.size || (d.talla || '')).trim(),
          encontrado: !!(d.description || d.price || d.colorDescription || d.size || d.talla),
        });
      }
    } catch (e) {
      redes = false;
      resultados.set(codigo, crearVacio());
    }
    mostrarEstado(true, `Consultando base de datos… ${i + 1} / ${total}`);
  }
  mostrarEstado(false);

  // mapear al orden original (con duplicados)
  return codigos.map(codigo => {
    const d = resultados.get(codigo) || crearVacio();
    return {
      barcode: codigo,
      articulo: codigo.split('!')[0] || codigo,
      color: (codigo.split('!')[1] || ''),
      talla: d.talla,
      description: d.description,
      colorDescription: d.colorDescription,
      price: d.price,
      encontrado: d.encontrado,
    };
  });
}

function crearVacio() {
  return { description: '', price: '', colorDescription: '', talla: '', encontrado: false };
}

/* Procesa el archivo seleccionado/arrastrado */
async function procesarArchivo(archivo) {
  // resetear
  filas = [];
  indicePreview = -1;
  redes = true;
  $('chip-archivo').hidden = false;
  $('chip-archivo').textContent = '';
  $('chip-archivo').innerHTML = `<i class="fa-solid fa-file-excel"></i> ${escaparHTML(archivo.name)}`;

  try {
    const codigos = await leerArchivo(archivo);
    if (codigos.length === 0) {
      toast('El archivo está vacío o sin códigos válidos.', 'error');
      return;
    }
    filas = await enriquecerCodigos(codigos);
    if (!redes) {
      toast('Backend no disponible: los registros se muestran con datos locales (Código).', 'error');
    }
    actualizarResumen();
    dibujarTabla();
    if (filas.length > 0) {
      indicePreview = 0;
      $previewRecord.value = '0';
      actualizarPreview();
    }
    toast(`Se cargaron ${filas.length} registros.`, 'success');
  } catch (e) {
    console.error(e);
    toast('Error al procesar el archivo: ' + e.message, 'error');
  }
}

/* ============================================================================
   GENERACIÓN DE PDF
   ============================================================================ */
function abrirModalPdf() {
  if (filas.length === 0) {
    toast('Primero cargá un archivo para generar etiquetas.', 'error');
    return;
  }
  const c = configDisenio;
  const n = filas.length;
  const p = c.pagina_mm || [210, 297];
  const capacidad = capacidadPorPagina(c, p[0], p[1]);
  const paginas = Math.ceil(n / capacidad);

  $('modal-etiquetas').textContent = n;
  $('modal-tamano').textContent = `${c.ancho_mm} × ${c.alto_mm} mm`;
  $('modal-codigo').textContent = c.tipo.toUpperCase();
  $('modal-pagina').textContent = `${p[0]} × ${p[1]} mm (${paginas} pág.)`;
  $('modal-pdf').hidden = false;
}

function capacidadPorPagina(c, pagW, pagH) {
  const m = c.margen_mm, hueco = c.hueco_mm;
  const cols = Math.max(1, Math.floor((pagW - 2 * m + hueco) / (c.ancho_mm + hueco)));
  const rows = Math.max(1, Math.floor((pagH - 2 * m + hueco) / (c.alto_mm + hueco)));
  return cols * rows;
}

async function generarPdfConfirmado() {
  const c = configDisenio;
  const p = c.pagina_mm || [210, 297];
  const m = c.margen_mm, hueco = c.hueco_mm;
  const cols = Math.max(1, Math.floor((p[0] - 2 * m + hueco) / (c.ancho_mm + hueco)));
  const rows = Math.max(1, Math.floor((p[1] - 2 * m + hueco) / (c.alto_mm + hueco)));
  const porPagina = cols * rows;
  const paginas = Math.ceil(filas.length / porPagina);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: p[0] > p[1] ? 'landscape' : 'portrait', unit: 'mm', format: p });

  mostrarEstado(true, 'Generando etiquetas…');
  try {
    let idx = 0;
    for (let pag = 0; pag < paginas; pag++) {
      if (pag > 0) doc.addPage();
      for (let r = 0; r < rows; r++) {
        for (let cc = 0; cc < cols; cc++) {
          if (idx >= filas.length) break;
          const record = filas[idx];
          const canvas = await renderLabelCanvas(record);
          const x = m + cc * (c.ancho_mm + hueco);
          const y = m + r * (c.alto_mm + hueco);
          doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, c.ancho_mm, c.alto_mm);
          idx++;
        }
        if (idx >= filas.length) break;
      }
    }
  } finally {
    mostrarEstado(false);
  }

  doc.save('etiquetas.pdf');
  $('modal-pdf').hidden = true;
  toast(`PDF generado con ${filas.length} etiquetas.`, 'success');
}

/* ============================================================================
   UI: ESTADO, TOASTS
   ============================================================================ */
function mostrarEstado(visible, texto = '') {
  $('estado').hidden = !visible;
  if (visible) $('estado-texto').textContent = texto;
}

function toast(mensaje, tipo = 'success') {
  const cont = $('toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + (tipo === 'success' ? 'toast--success' : tipo === 'error' ? 'toast--error' : '');
  const icon = tipo === 'success' ? 'fa-circle-check' : tipo === 'error' ? 'fa-circle-xmark' : 'fa-circle-info';
  t.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapaTexto(mensaje)}</span>`;
  cont.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  }, 3200);
}

/* ============================================================================
   UTILIDADES
   ============================================================================ */
function formatearPrecio(precio) {
  const n = Number(precio);
  if (isNaN(n)) return String(precio ?? '');
  try { return formateadorMoneda.format(n); } catch (e) { return String(precio); }
}

function escaper(v) { return escaparHTML(v ?? ''); }

function escaparHTML(valor) {
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function escapaTexto(txt) {
  const div = document.createElement('div');
  div.textContent = txt;
  return div.innerHTML;
}

/* ============================================================================
   EVENTOS
   ============================================================================ */
function configurarEventos() {
  const dropz = $('dropzone');
  const $archivo = $('archivo');

  // --- drag & drop ---
  dropz.addEventListener('click', (e) => { if (e.target !== $('chip-archivo')) $archivo.click(); });
  $archivo.addEventListener('change', () => { if ($archivo.files[0]) procesarArchivo($archivo.files[0]); });
  $('btn-archivo').addEventListener('click', () => $archivo.click());

  ['dragenter', 'dragover'].forEach(ev => dropz.addEventListener(ev, (e) => {
    e.preventDefault(); dropz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(ev => dropz.addEventListener(ev, (e) => {
    e.preventDefault(); dropz.classList.remove('drag-over');
  }));
  dropz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) procesarArchivo(f);
  });

  // --- controles de diseño (autosave + preview en vivo) ---
  const inputs = [
    'cfg-ancho', 'cfg-alto', 'cfg-contenido', 'cfg-texto-bajo',
    'cfg-altura-bc', 'cfg-fuente', 'cfg-acento',
  ];
  inputs.forEach(id => {
    const el = $(id);
    el.addEventListener('input', () => {
      leerConfigDelForm();
      guardarDisenio();
      $('cfg-altura-bc-valor').textContent = configDisenio.altura_bc_mm + ' mm';
      $('cfg-fuente-valor').textContent = configDisenio.fuentes + ' px';
      actualizarPreview();
    });
    el.addEventListener('change', () => { leerConfigDelForm(); guardarDisenio(); actualizarPreview(); });
  });

  document.querySelectorAll('#cfg-tipo .segmented__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cfg-tipo .segmented__btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      leerConfigDelForm(); guardarDisenio(); actualizarPreview();
    });
  });

  document.querySelectorAll('[data-campo]').forEach(cb => {
    cb.addEventListener('change', () => {
      leerConfigDelForm(); guardarDisenio(); actualizarPreview();
    });
  });

  // --- selector de preview ---
  $previewRecord.addEventListener('change', () => {
    const v = parseInt($previewRecord.value, 10);
    if (!isNaN(v) && v >= 0 && v < filas.length) {
      indicePreview = v;
      dibujarTabla();
      actualizarPreview();
    }
  });

  // --- restablecer ---
  $('btn-restablecer').addEventListener('click', () => {
    configDisenio = disenioPorDefecto();
    aplicarConfigAlForm();
    guardarDisenio();
    actualizarPreview();
    toast('Diseño restablecido a los valores por defecto.', 'success');
  });

  // --- limpiar datos ---
  $('btn-limpiar-datos').addEventListener('click', () => {
    filas = [];
    indicePreview = -1;
    dibujarTabla();
    actualizarResumen();
    $etiqueta.innerHTML = '<div style="padding:40px;color:#8a94a3;text-align:center;font-size:.9rem">Sin etiqueta para mostrar.</div>';
    $previewRecord.disabled = true;
    $('chip-archivo').hidden = true;
    toast('Datos limpiados.', 'success');
  });

  // --- PDF ---
  $('btn-generar').addEventListener('click', abrirModalPdf);
  $('modal-cancelar').addEventListener('click', () => { $('modal-pdf').hidden = true; });
  $('modal-pdf').addEventListener('click', (e) => { if (e.target === $('modal-pdf')) $('modal-pdf').hidden = true; });
  $('modal-confirmar').addEventListener('click', generarPdfConfirmado);

  // cerrar modal con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('modal-pdf').hidden = true;
  });
}

/* ============================================================================
   ARRANQUE
   ============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  configDisenio = cargarDisenio();
  aplicarConfigAlForm();
  configurarEventos();

  // demostración de la etiqueta sin datos cargados
  filas = [{
    barcode: 'CA13315C!02!10',
    articulo: 'CA13315C',
    color: '02',
    talla: '10',
    description: 'Polo manga corta premium algodón',
    colorDescription: 'Negro',
    price: '1500',
    encontrado: true,
  }];
  indicePreview = 0;
  actualizarResumen();
  dibujarTabla();
  $previewRecord.value = '0';
  actualizarPreview();
});

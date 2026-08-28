/**
 * ============================================================================
 *  LÓGICA FRONTEND - Enriquecer Productos por Código de Barras
 * ============================================================================
 *  Responsabilidades:
 *   1. Leer el archivo seleccionado (.xlsx / .xls / .txt).
 *   2. Extraer los códigos de barras (de Excel o de texto plano).
 *   3. Consultar el backend por cada código para enriquecer la información.
 *   4. Mostrar una tabla de previsualización.
 *   5. Generar y descargar un PDF profesional.
 *
 *  NOTA: el backend debe estar corriendo en http://localhost:3000
 * ============================================================================
 */

// ---------------------------------------------------------------------------
//  CONFIGURACIÓN (fácil de modificar)
// ---------------------------------------------------------------------------
const URL_API = 'http://localhost:3000';        // URL del backend
const NOMBRE_PDF = 'productos_enriquecidos.pdf'; // Nombre del PDF generado

// Formateador de moneda (Pesos Colombianos, cambiable)
const formateadorMoneda = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

// ---------------------------------------------------------------------------
//  REFERENCIAS A ELEMENTOS DEL DOM
// ---------------------------------------------------------------------------
const $archivo = document.getElementById('archivo');          // Input de archivo
const $nombreArchivo = document.getElementById('nombre-archivo');
const $btnPreview = document.getElementById('btn-preview');   // Botón Previsualizar
const $btnPdf = document.getElementById('btn-pdf');           // Botón Generar PDF
const $progreso = document.getElementById('progreso');
const $barraLlena = document.getElementById('barra-llena');
const $textoProgreso = document.getElementById('texto-progreso');
const $tablaCuerpo = document.getElementById('tabla-cuerpo'); // Cuerpo de la tabla
const $sinDatos = document.getElementById('sin-datos');
const $resumen = document.getElementById('resumen');
const $resumenContenido = document.getElementById('resumen-contenido');

// Estado de la aplicación: filas con los datos enriquecidos
let filas = [];   // { barcode, description, price, colorDescription, size, encontrado }

// ---------------------------------------------------------------------------
//  EVENTO: al seleccionar un archivo
// ---------------------------------------------------------------------------
$archivo.addEventListener('change', () => {
  const archivo = $archivo.files[0];
  if (!archivo) {
    $nombreArchivo.textContent = 'Ningún archivo seleccionado';
    $btnPreview.disabled = true;
    $btnPdf.disabled = true;
    return;
  }

  // Mostrar el nombre del archivo elegido
  $nombreArchivo.textContent = '📁 ' + archivo.name;

  // Limpiar datos anteriores
  filas = [];
  limpiarTabla();

  // Habilitar los botones de acción
  $btnPreview.disabled = false;
  $btnPdf.disabled = true;   // El PDF se habilita tras previsualizar
});

// ---------------------------------------------------------------------------
//  EVENTO: botón "Previsualizar"
// ---------------------------------------------------------------------------
$btnPreview.addEventListener('click', async () => {
  const archivo = $archivo.files[0];
  if (!archivo) {
    alert('Por favor, selecciona primero un archivo.');
    return;
  }

  try {
    // 1) Leer el archivo y extraer los códigos de barras
    const codigos = await leerArchivo(archivo);

    if (codigos.length === 0) {
      alert('El archivo está vacío o no contiene códigos de barras válidos.');
      limpiarTabla();
      actualizarResumen(0, 0, 0, []);
      $btnPdf.disabled = true;
      return;
    }

    // 2) Eliminar códigos duplicados para el resumen (mantener el orden)
    const unicos = [...new Set(codigos)];

    // 3) Enriquecer cada código consultando el backend
    mostrarProgreso(true, 0, 'Consultando base de datos...');
    const resultados = await enriquecerCodigos(unicos, archivo.name);

    // 4) Montar las filas (conservando el orden y duplicados originales)
    filas = montarFilas(codigos, resultados);

    // 5) Dibujar la tabla y el resumen
    dibujarTabla(filas);
    mostrarProgreso(false);

    const conDatos = filas.filter(f => f.encontrado).length;
    const sinDatosLista = filas.filter(f => !f.encontrado).map(f => f.barcode);
    actualizarResumen(filas.length, conDatos, unicos.length, sinDatosLista);

    // 6) El PDF se puede generar ahora
    $btnPdf.disabled = false;

  } catch (error) {
    console.error(error);
    alert('Ocurrió un error al procesar el archivo:\n\n' + error.message);
    mostrarProgreso(false);
  }
});

// ---------------------------------------------------------------------------
//  EVENTO: botón "Generar PDF"
// ---------------------------------------------------------------------------
$btnPdf.addEventListener('click', () => {
  if (filas.length === 0) {
    alert('No hay datos para generar el PDF. Pulsa primero "Previsualizar".');
    return;
  }
  generarPDF(filas);
});

// ---------------------------------------------------------------------------
//  LECTURA DEL ARCHIVO (TXT o Excel)
// ---------------------------------------------------------------------------
/**
 * Lee un archivo y devuelve un array de códigos de barras (strings).
 * @param {File} archivo - El archivo seleccionado por el usuario.
 * @returns {Promise<string[]>}
 */
async function leerArchivo(archivo) {
  const nombre = archivo.name.toLowerCase();

  // --- Archivo de texto (.txt): una línea = un código ---
  if (nombre.endsWith('.txt')) {
    const texto = await archivo.text();
    return texto
      .split(/\r?\n/)                    // separar por líneas
      .map(linea => linea.trim())        // quitar espacios
      .filter(linea => linea.length > 0) // descartar líneas vacías
      .filter(linea => !linea.startsWith('#')); // líneas de comentario opcionales
  }

  // --- Archivo Excel (.xlsx / .xls): leer con la librería XLSX ---
  if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
    return leerExcel(archivo);
  }

  // Formato no soportado
  throw new Error('Formato de archivo no soportado. Usa .txt, .xlsx o .xls');
}

/**
 * Lee un archivo Excel y extrae los códigos de barras de la primera hoja,
 * detectando las columnas de manera inteligente.
 * @param {File} archivo
 * @returns {Promise<string[]>}
 */
async function leerExcel(archivo) {
  // Convertir el archivo a ArrayBuffer (lo que espera la librería XLSX)
  const buffer = await archivo.arrayBuffer();

  // Cargar el libro completo
  const libro = XLSX.read(buffer, { type: 'array' });

  // Usar la primera hoja
  const primeraHoja = libro.SheetNames[0];
  if (!primeraHoja) {
    throw new Error('El archivo Excel no contiene hojas.');
  }

  const hoja = libro.Sheets[primeraHoja];

  // Convertir la hoja a una matriz de objetos (filas de la hoja)
  const filasHoja = XLSX.utils.sheet_to_json(hoja, { defval: '' });

  if (filasHoja.length === 0) {
    return [];
  }

  // Detectar la columna del código de barras de forma inteligente
  const columnaCodigo = detectarColumnaCodigo(filasHoja[0]);

  if (!columnaCodigo) {
    throw new Error(
      'No se pudo detectar la columna del código de barras. ' +
      'Asegúrate de que la primera hoja tenga una columna llamada ' +
      'BARCODE, CODIGO o CODE (no importa mayúsculas/minúsculas).'
    );
  }

  // Extraer todos los códigos no vacíos
  const codigos = filasHoja
    .map(fila => String(fila[columnaCodigo]).trim())
    .filter(codigo => codigo.length > 0);

  return codigos;
}

/**
 * Detecta qué columna (clave del objeto) contiene los códigos de barras.
 * Busca nombres como BARCODE, CODIGO, CODE (insensible a mayúsculas).
 * @param {object} filaEjemplo - Primer fila de la hoja.
 * @returns {string|null} - La clave de la columna detectada, o null.
 */
function detectarColumnaCodigo(filaEjemplo) {
  const sinonimos = ['barcode', 'codigo', 'code', 'cod', 'referencia'];

  for (const clave of Object.keys(filaEjemplo)) {
    const claveNormalizada = clave.trim().toLowerCase();
    if (sinonimos.some(s => claveNormalizada === s || claveNormalizada.includes(s))) {
      return clave;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
//  ENRIQUECIMIENTO DE DATOS (consulta al backend)
// ---------------------------------------------------------------------------
/**
 * Consulta el backend por cada código y devuelve un mapa código -> datos.
 * Muestra una barra de progreso.
 * @param {string[]} codigos - Códigos únicos a consultar.
 * @param {string} nombreArchivo - Nombre del archivo (solo para el log).
 * @returns {Promise<Map<string, object>>}
 */
async function enriquecerCodigos(codigos, nombreArchivo) {
  const resultados = new Map();
  const total = codigos.length;

  for (let i = 0; i < total; i++) {
    const codigo = codigos[i];

    try {
      // Construir la URL con el código codificado (espacios, caracteres especiales)
      const url = `${URL_API}/api/producto?barcode=${encodeURIComponent(codigo)}`;
      const respuesta = await fetch(url);

      if (!respuesta.ok) {
        // Por ejemplo un error 4xx/5xx del servidor: tratar como "sin datos"
        const cuerpo = await respuesta.json().catch(() => ({}));
        console.warn(`Código ${codigo}: respuesta ${respuesta.status}`, cuerpo.error || '');
        resultados.set(codigo, crearVacio());
      } else {
        const datos = await respuesta.json();
        resultados.set(codigo, {
          description: (datos.description || '').trim(),
          price: datos.price ?? '',
          colorDescription: (datos.colorDescription || '').trim(),
          size: (datos.size || '').trim(),
          encontrado: !!(datos.description || datos.price || datos.colorDescription || datos.size)
        });
      }
    } catch (error) {
      // Error de red: el backend no está disponible
      console.error(`Error de red consultando ${codigo}:`, error.message);
      resultados.set(codigo, crearVacio());
    }

    // Actualizar la barra de progreso
    const porcentaje = Math.round(((i + 1) / total) * 100);
    mostrarProgreso(true, porcentaje, `Consultando ${i + 1} de ${total}...`);
  }

  return resultados;
}

/**
 * Devuelve un registro "vacío" (producto no encontrado o error de red).
 */
function crearVacio() {
  return { description: '', price: '', colorDescription: '', size: '', encontrado: false };
}

/**
 * Construye el array final de filas a partir de los códigos originales
 * (incluidos duplicados) y el mapa de resultados del backend.
 * @param {string[]} codigos - Códigos con duplicados, en orden original.
 * @param {Map} resultados - Mapa código -> datos.
 * @returns {object[]}
 */
function montarFilas(codigos, resultados) {
  return codigos.map(codigo => {
    const datos = resultados.get(codigo) || crearVacio();
    return { barcode: codigo, ...datos };
  });
}

// ---------------------------------------------------------------------------
//  RENDER: TABLA DE PREVISUALIZACIÓN
// ---------------------------------------------------------------------------
/**
 * Dibuja las filas en la tabla del HTML.
 * @param {object[]} filas - Las filas enriquecidas.
 */
function dibujarTabla(filas) {
  // Limpiar el cuerpo de la tabla
  $tablaCuerpo.innerHTML = '';

  filas.forEach((fila, indice) => {
    const tr = document.createElement('tr');

    // Si el producto no se encontró, aplicarle la clase de alerta
    if (!fila.encontrado) {
      tr.classList.add('sin-datos');
    }

    tr.innerHTML = `
      <td>${indice + 1}</td>
      <td><strong>${escaparHTML(fila.barcode)}</strong></td>
      <td>${fila.encontrado ? escaparHTML(fila.description) : 'Sin datos'}</td>
      <td>${fila.encontrado ? (fila.price !== '' ? formatearPrecio(fila.price) : '') : ''}</td>
      <td>${fila.encontrado ? escaparHTML(fila.colorDescription) : ''}</td>
      <td>${fila.encontrado ? escaparHTML(fila.size) : ''}</td>
    `;

    $tablaCuerpo.appendChild(tr);
  });

  // Mostrar u ocultar el mensaje de "sin datos"
  $sinDatos.hidden = filas.length > 0;
}

/**
 * Limpia la tabla y oculta el mensaje de ayuda.
 */
function limpiarTabla() {
  $tablaCuerpo.innerHTML = '';
  $sinDatos.hidden = true;
}

// ---------------------------------------------------------------------------
//  RENDER: RESUMEN
// ---------------------------------------------------------------------------
/**
 * Muestra el resumen de la operación.
 * @param {number} total - Total de códigos (con duplicados).
 * @param {number} conDatos - Códigos con datos en la BD.
 * @param {number} unicos - Códigos únicos consultados.
 * @param {string[]} sinEncontrar - Lista de códigos no encontrados.
 */
function actualizarResumen(total, conDatos, unicos, sinEncontrar) {
  $resumen.hidden = false;
  $resumenContenido.innerHTML = `
    <div class="resumen-item">
      <div class="numero">${total}</div>
      <div class="etiqueta">Códigos leídos</div>
    </div>
    <div class="resumen-item">
      <div class="numero">${unicos}</div>
      <div class="etiqueta">Códigos únicos</div>
    </div>
    <div class="resumen-item">
      <div class="numero">${conDatos}</div>
      <div class="etiqueta">Con datos en BD</div>
    </div>
    <div class="resumen-item alertas">
      <div class="numero">${sinEncontrar.length}</div>
      <div class="etiqueta">Sin datos</div>
    </div>
  `;

  // Si hay códigos sin datos, mostrar cuáles fueron (máximo 10)
  if (sinEncontrar.length > 0) {
    const p = document.createElement('p');
    p.className = 'ayuda';
    p.innerHTML = `⚠️ <strong>${sinEncontrar.length}</strong> código(s) sin datos en la base de datos: ` +
      sinEncontrar.slice(0, 10).map(c => `<code>${escaparHTML(c)}</code>`).join(', ') +
      (sinEncontrar.length > 10 ? ` ... y ${sinEncontrar.length - 10} más` : '');
    $resumenContenido.appendChild(p);
  }
}

// ---------------------------------------------------------------------------
//  GENERACIÓN DEL PDF
// ---------------------------------------------------------------------------
/**
 * Genera un PDF profesional con los datos enriquecidos y lo descarga.
 * @param {object[]} filas - Las filas enriquecidas.
 */
function generarPDF(filas) {
  // Acceder a jsPDF (expuesto globalmente por la librería UMD)
  const { jsPDF } = window.jspdf;

  // 1) Crear el documento PDF (unidad mm, tamaño A4, orientación horizontal)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const anchoPagina = doc.internal.pageSize.getWidth();

  // 2) Título del documento
  doc.setFontSize(18);
  doc.setTextColor(37, 99, 235); // Azul oscuro (#2563eb)
  doc.text('Listado de Productos', anchoPagina / 2, 18, { align: 'center' });

  // 3) Línea separadora debajo del título
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.6);
  doc.line(14, 23, anchoPagina - 14, 23);

  // 4) Preparar los datos de la tabla (array de arrays)
  const cabecera = ['#', 'Código de barras', 'Descripción', 'Precio', 'Color', 'Talla'];
  const cuerpo = filas.map((fila, indice) => [
    String(indice + 1),
    fila.barcode,
    fila.encontrado ? fila.description : 'Sin datos',
    fila.encontrado && fila.price !== '' ? formatearPrecio(fila.price).replace(/\u00A0/g, ' ') : '',
    fila.encontrado ? fila.colorDescription : '',
    fila.encontrado ? fila.size : ''
  ]);

  // 5) Dibujar la tabla con jspdf-autotable
  //    startY: posición inicial del título autotable
  //    theme: 'grid' → tabla con bordes visibles y separación
  doc.autoTable({
    head: [cabecera],
    body: cuerpo,
    startY: 28,
    theme: 'grid',
    headStyles: {
      fillColor: [37, 99, 235],   // azul de cabecera
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center'
    },
    alternateRowStyles: {
      fillColor: [245, 247, 250]   // filas alternas muy claras
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      overflow: 'linebreak',
      valign: 'middle'
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 55 },
      3: { halign: 'right', cellWidth: 35 },
    },
    didParseCell: (datos) => {
      // Resaltar en ámbar las filas sin datos
      if (datos.section === 'body' && datos.row.index !== undefined) {
        const filaDato = filas[datos.row.index];
        if (filaDato && !filaDato.encontrado) {
          datos.cell.styles.fillColor = [253, 243, 199]; // ámbar claro
          datos.cell.styles.textColor = [146, 64, 14];
          datos.cell.styles.fontStyle = 'italic';
        }
      }
    }
  });

  // 6) Resumen al pie del documento (opcional, mejora el profesionalismo)
  const total = filas.length;
  const conDatos = filas.filter(f => f.encontrado).length;
  const sinDatos = total - conDatos;
  // Obtener la posición Y donde terminó la tabla
  let yFinal = 28;
  const finalAutotable = doc.lastAutoTable;
  if (finalAutotable && finalAutotable.finalY) {
    yFinal = finalAutotable.finalY + 8;
  }

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139); // gris suave
  doc.text(
    `Total de productos: ${total}   |   Con datos: ${conDatos}   |   Sin datos: ${sinDatos}`,
    14,
    yFinal
  );
  doc.text(
    `Generado el ${new Date().toLocaleString('es-CO')}`,
    14,
    yFinal + 5
  );

  // 7) Descargar el PDF
  doc.save(NOMBRE_PDF);
}

// ---------------------------------------------------------------------------
//  BARRA DE PROGRESO
// ---------------------------------------------------------------------------
/**
 * Muestra u oculta la barra de progreso y actualiza su valor.
 * @param {boolean} visible - Mostrar u ocultar.
 * @param {number} porcentaje - Porcentaje (0-100).
 * @param {string} texto - Texto descriptivo.
 */
function mostrarProgreso(visible, porcentaje = 0, texto = '') {
  $progreso.hidden = !visible;
  if (visible) {
    $barraLlena.style.width = porcentaje + '%';
    $textoProgreso.textContent = texto;
  }
}

// ---------------------------------------------------------------------------
//  UTILIDADES
// ---------------------------------------------------------------------------
/**
 * Escapa caracteres HTML para evitar inyección en la tabla.
 * @param {string|number} valor
 * @returns {string}
 */
function escaparHTML(valor) {
  const texto = String(valor ?? '');
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formatea un precio para mostrarlo con formato de moneda.
 * @param {string|number} precio
 * @returns {string}
 */
function formatearPrecio(precio) {
  const numero = Number(precio);
  if (isNaN(numero)) {
    return String(precio ?? '');
  }
  return formateadorMoneda.format(numero);
}

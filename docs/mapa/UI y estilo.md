# UI y estilo

- Estilo **glass** en todo el hub; pantallas al 100 % del ancho del dispositivo.
- Tema claro/oscuro: clase `:root.light` + tokens CSS (`--surface`, `--surface-solid`…). Los brillos de fondo usan la clase `.glow` (nunca `.light`, choca con el tema).
- **Íconos sin colores repetidos** en una misma pantalla: usar `coloresUnicos()`.
- `BotonFlotante`: botón movible a voluntad (Facturación fábrica).
- Accesos directos del menú principal van abajo (`enMenu`).
- Verde flúor (`lime`) = llegó de más; rojo = cancelado/faltante; ámbar = saldo pendiente.
- Antes de cambios visuales grandes el usuario suele pedir un mockup HTML (`mockups/`).
